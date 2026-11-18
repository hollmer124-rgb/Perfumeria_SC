import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PSQL_EXECUTABLE = "psql";
const DATABASE_NAME = "postgres";
const DATABASE_USER = "postgres";
const DATABASE_PORT = "54322";
const CONNECT_TIMEOUT_SECONDS = 3;
const LOCK_TIMEOUT_MS = 18_000;
const STATEMENT_TIMEOUT_MS = 25_000;
const PROCESS_TIMEOUT_MS = 30_000;
const OBSERVER_TIMEOUT_MS = 5_000;
const OBSERVATION_TIMEOUT_MS = 8_000;
const SCENARIO_TIMEOUT_MS = 38_000;
const HOLD_SECONDS = 8;
const HARNESS_WORK_TIMEOUT_MS = 260_000;
const CLEANUP_TIMEOUT_MS = 20_000;
const HARNESS_TOTAL_TIMEOUT_MS =
  HARNESS_WORK_TIMEOUT_MS + CLEANUP_TIMEOUT_MS + 8_000 + 5_000;

function parseLocalDatabaseUrl() {
  const raw = process.env.LOCAL_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "Set LOCAL_DATABASE_URL to the local Supabase PostgreSQL URL."
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LOCAL_DATABASE_URL is not a valid PostgreSQL URL.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    (isIP(host) === 4 && host === "127.0.0.1") ||
    (isIP(host) === 6 && host === "::1");

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !isLoopback ||
    url.port !== DATABASE_PORT ||
    url.pathname !== `/${DATABASE_NAME}` ||
    url.search !== "" ||
    url.hash !== "" ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    throw new Error(
      "Refusing to run: LOCAL_DATABASE_URL must be a query-free PostgreSQL URL " +
        "for 127.0.0.1 or ::1, port 54322, database postgres."
    );
  }

  let username;
  let password;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error("LOCAL_DATABASE_URL contains invalid credentials.");
  }

  if (
    username !== DATABASE_USER ||
    password.length === 0 ||
    /[\u0000-\u001f\u007f]/.test(password)
  ) {
    throw new Error(
      "Refusing to run: the local database URL must use the postgres user " +
        "and include its password."
    );
  }

  return Object.freeze({
    host,
    port: DATABASE_PORT,
    database: DATABASE_NAME,
    username: DATABASE_USER,
    password,
  });
}

const initialConnection = parseLocalDatabaseUrl();

function assertLocalConnectionUnchanged() {
  const current = parseLocalDatabaseUrl();
  if (
    current.host !== initialConnection.host ||
    current.port !== initialConnection.port ||
    current.database !== initialConnection.database ||
    current.username !== initialConnection.username ||
    current.password !== initialConnection.password
  ) {
    throw new Error(
      "Refusing to connect or clean up: the validated local connection changed."
    );
  }
  return current;
}

const fixture = {
  adminId: randomUUID(),
  perfumeIds: Array.from({ length: 10 }, () => randomUUID()),
  recipeIds: Array.from({ length: 10 }, () => randomUUID()),
  essenceId: randomUUID(),
  bottleIds: Array.from({ length: 10 }, () => randomUUID()),
};

const recipeIdsByScenario = new Map([
  ["activation-before-component-update", [fixture.recipeIds[0]]],
  ["activation-before-component-delete", [fixture.recipeIds[1]]],
  ["component-update-before-activation", [fixture.recipeIds[2]]],
  ["component-delete-before-activation", [fixture.recipeIds[3]]],
  ["admin-save-before-create-version", [fixture.recipeIds[4]]],
  ["activation-before-create-version", [fixture.recipeIds[5]]],
  [
    "move-active-recipe-before-draft",
    [fixture.recipeIds[6], fixture.recipeIds[7]],
  ],
  [
    "move-draft-before-activation",
    [fixture.recipeIds[8], fixture.recipeIds[9]],
  ],
]);
const dynamicRecipes = new Map();
const runningProcesses = new Set();
const tempDir = await mkdtemp(join(tmpdir(), "recipe-concurrency-"));
let fixtureSetupCompleted = false;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlUuidList(values) {
  if (values.length === 0) {
    throw new Error("Refusing to build an empty fixture UUID list.");
  }
  return values.map((value) => `${sqlLiteral(value)}::uuid`).join(", ");
}

function sqlTextList(values) {
  if (values.length === 0) {
    throw new Error("Refusing to build an empty audit text list.");
  }
  return values.map(sqlLiteral).join(", ");
}

function allKnownRecipeIds() {
  return [
    ...Array.from(recipeIdsByScenario.values()).flat(),
    ...Array.from(dynamicRecipes.values(), (recipe) => recipe.id),
  ];
}

function actorSql() {
  return `
set local role authenticated;
select set_config('request.jwt.claim.sub', ${sqlLiteral(fixture.adminId)}, true);
select set_config(
  'request.jwt.claims',
  ${sqlLiteral(
    JSON.stringify({
      sub: fixture.adminId,
      role: "authenticated",
    })
  )},
  true
);
do $actor_context$
begin
  if auth.uid() is distinct from ${sqlLiteral(fixture.adminId)}::uuid then
    raise exception 'Concurrency connection has an unexpected auth.uid()';
  end if;
  if private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Concurrency connection actor is not an administrator';
  end if;
end;
$actor_context$;`;
}

function childEnvironment(appName) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /^(PG|PSQL|PSQL_PATH|PG_BIN|POSTGRES_BIN|POSTGRESQL_BIN)/i.test(key)
    ) {
      continue;
    }
    env[key] = value;
  }

  const connection = assertLocalConnectionUnchanged();
  env.PGPASSWORD = connection.password;
  env.PGAPPNAME = appName;
  env.PGCONNECT_TIMEOUT = String(CONNECT_TIMEOUT_SECONDS);
  env.PGSSLMODE = "disable";
  return env;
}

function connectionArguments(args) {
  const connection = assertLocalConnectionUnchanged();
  const conninfo =
    `host=${connection.host} hostaddr=${connection.host} ` +
    `port=${connection.port} dbname=${connection.database} ` +
    `user=${connection.username} connect_timeout=${CONNECT_TIMEOUT_SECONDS} ` +
    "sslmode=disable";

  return [
    "-X",
    "-w",
    "-v",
    "ON_ERROR_STOP=1",
    "--dbname",
    conninfo,
    ...args,
  ];
}

function isRunning(child) {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateChild(child, completion) {
  if (!isRunning(child)) {
    return;
  }

  const settled = completion.then(
    () => undefined,
    () => undefined
  );
  child.kill("SIGTERM");
  await Promise.race([settled, delay(1_000)]);

  if (isRunning(child)) {
    child.kill(process.platform === "win32" ? "SIGTERM" : "SIGKILL");
    await Promise.race([settled, delay(1_000)]);
  }

  if (isRunning(child)) {
    throw new Error(`Could not terminate psql process ${child.pid}.`);
  }
}

async function runPsql(args, appName, label, options = {}) {
  const { timeoutMs = PROCESS_TIMEOUT_MS, signal, captureRecipe } = options;
  assertLocalConnectionUnchanged();
  if (signal?.aborted) {
    throw new Error(
      `${label}: aborted before connection: ${signal.reason?.message ?? "timeout"}`
    );
  }

  const child = spawn(
    PSQL_EXECUTABLE,
    connectionArguments(args),
    {
      env: childEnvironment(appName),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  runningProcesses.add(child);

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });

  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, childSignal) => {
      const result = { code, signal: childSignal, stdout, stderr };
      if (stdout.includes("FIXTURE_SETUP_COMPLETED")) {
        fixtureSetupCompleted = true;
      }
      const marker = stdout.match(
        /CREATED_RECIPE_ID=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );
      if (captureRecipe && marker) {
        dynamicRecipes.set(captureRecipe.scenario, {
          id: marker[1],
          perfumeId: captureRecipe.perfumeId,
        });
      }
      resolve(result);
    });
  });

  let termination;
  const terminate = () => {
    if (!termination) {
      termination = terminateChild(child, completion);
    }
    return termination;
  };

  let timeoutHandle;
  let abortHandler;
  const timeoutError = new Error(
    `${label}: process timeout after ${timeoutMs} ms.`
  );
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      void terminate().then(
        () => reject(timeoutError),
        (error) => reject(new Error(`${timeoutError.message} ${error.message}`))
      );
    }, timeoutMs);
  });
  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortHandler = () => {
          const error = new Error(
            `${label}: aborted: ${signal.reason?.message ?? "timeout"}.`
          );
          void terminate().then(
            () => reject(error),
            (terminationError) =>
              reject(
                new Error(`${error.message} ${terminationError.message}`)
              )
          );
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      })
    : new Promise(() => {});

  try {
    const result = await Promise.race([
      completion,
      timeoutPromise,
      abortPromise,
    ]);
    return result;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    try {
      await terminate();
    } finally {
      runningProcesses.delete(child);
    }
  }
}

function assertProcessSucceeded(result, label) {
  if (result.code !== 0) {
    throw new Error(
      `${label} failed (exit ${result.code ?? result.signal}):\n` +
        `${result.stdout}\n${result.stderr}`
    );
  }
}

async function runSql(sql, label, signal, timeoutMs = 8_000) {
  const result = await runPsql(
    [
      "-q",
      "-t",
      "-A",
      "--command",
      `set statement_timeout = '5s'; ${sql}`,
    ],
    `recipe-concurrency-${label}`,
    label,
    { timeoutMs, signal }
  );
  assertProcessSucceeded(result, label);
  return result.stdout.trim();
}

async function writeSql(name, sql) {
  const file = join(tempDir, `${name}.sql`);
  await writeFile(file, sql, "utf8");
  return file;
}

function securityDefinerPreflightSql() {
  return `
with helper as (
  select p.oid, p.proowner, p.prosecdef
    from pg_catalog.pg_proc as p
   where p.oid = 'private.acquire_recipe_write_lock()'::regprocedure
),
callers(oid) as (
  values
    ('private.serialize_recipe_write_statement()'::regprocedure),
    ('public.create_recipe_version(uuid)'::regprocedure),
    ('public.admin_save_recipe(uuid,uuid,integer,bigint,jsonb)'::regprocedure),
    ('public.activate_recipe(uuid)'::regprocedure)
),
details as (
  select c.oid,
         c.proowner,
         c.prosecdef,
         h.proowner as helper_owner,
         h.prosecdef as helper_security_definer,
         pg_catalog.has_function_privilege(
           c.proowner, h.oid, 'EXECUTE'
         ) as owner_can_execute_helper,
         pg_catalog.has_function_privilege(
           'authenticated', h.oid, 'EXECUTE'
         ) as authenticated_can_execute_helper
    from callers as wanted
    join pg_catalog.pg_proc as c on c.oid = wanted.oid
    cross join helper as h
)
select pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object(
    'function', oid::regprocedure::text,
    'owner', pg_catalog.pg_get_userbyid(proowner),
    'security_definer', prosecdef,
    'helper_owner', pg_catalog.pg_get_userbyid(helper_owner),
    'helper_security_definer', helper_security_definer,
    'owner_can_execute_helper', owner_can_execute_helper,
    'authenticated_can_execute_helper', authenticated_can_execute_helper
  )
  order by oid
)
from details;`;
}

async function checkSecurityDefinerPreflight(signal) {
  const output = await runSql(
    securityDefinerPreflightSql(),
    "security-definer preflight",
    signal
  );

  let details;
  try {
    details = JSON.parse(output);
  } catch {
    throw new Error(
      `Security-definer preflight returned invalid output: ${output}`
    );
  }

  const invalid = details.filter(
    (entry) =>
      !entry.security_definer ||
      !entry.helper_security_definer ||
      !entry.owner_can_execute_helper ||
      entry.authenticated_can_execute_helper
  );
  if (invalid.length > 0) {
    throw new Error(
      "Security-definer preflight failed; no fixtures were created:\n" +
        JSON.stringify(invalid, null, 2)
    );
  }
  console.log("PASS security-definer owner and EXECUTE preflight.");
}

function auditTriggerPreflightSql() {
  return `
with required(table_name, relation_name) as (
  values
    ('recipes', 'public.recipes'),
    ('recipe_components', 'public.recipe_components'),
    ('materials', 'public.materials')
),
resolved as (
  select required.table_name,
         required.relation_name,
         pg_catalog.to_regclass(required.relation_name) as relation_oid
    from required
),
audit_function as (
  select pg_catalog.to_regprocedure('private.audit_row_change()') as function_oid
),
audit_logs as (
  select pg_catalog.to_regclass('public.audit_logs') as relation_oid
),
trigger_rows as (
  select r.table_name,
         t.tgname,
         t.tgenabled,
         t.tgtype,
         t.tgisinternal,
         t.tgparentid
    from resolved as r
    join pg_catalog.pg_trigger as t
      on t.tgrelid = r.relation_oid
    cross join audit_function as f
   where f.function_oid is not null
     and t.tgfoid = f.function_oid
)
select pg_catalog.jsonb_build_object(
  'audit_function_exists', (select function_oid is not null from audit_function),
  'audit_logs_table_exists', (select relation_oid is not null from audit_logs),
  'audit_logs_columns', (
    select coalesce(pg_catalog.jsonb_object_agg(a.attname, true), '{}'::jsonb)
      from pg_catalog.pg_attribute as a
     cross join audit_logs as l
     where a.attrelid = l.relation_oid
       and a.attnum > 0
       and not a.attisdropped
  ),
  'tables', (
    select coalesce(
      pg_catalog.jsonb_object_agg(r.table_name, r.relation_oid is not null),
      '{}'::jsonb
    )
      from resolved as r
  ),
  'triggers', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table', tr.table_name,
          'name', tr.tgname,
          'enabled', tr.tgenabled,
          'row_level', (tr.tgtype & 1) = 1,
          'before', (tr.tgtype & 2) = 2,
          'insert', (tr.tgtype & 4) = 4,
          'delete', (tr.tgtype & 8) = 8,
          'update', (tr.tgtype & 16) = 16,
          'truncate', (tr.tgtype & 32) = 32,
          'internal', tr.tgisinternal,
          'parent_trigger', tr.tgparentid
        )
        order by tr.table_name, tr.tgname
      ),
      '[]'::jsonb
    )
      from trigger_rows as tr
  )
);`;
}

async function checkAuditTriggerPreflight(signal) {
  const output = await runSql(
    auditTriggerPreflightSql(),
    "audit trigger preflight",
    signal
  );

  let details;
  try {
    details = JSON.parse(output);
  } catch {
    throw new Error(
      `Audit trigger preflight returned invalid output: ${output}`
    );
  }

  const requiredTables = ["recipes", "recipe_components", "materials"];
  const requiredColumns = [
    "id",
    "actor_id",
    "actor_type",
    "action",
    "table_name",
    "record_id",
    "old_data",
    "new_data",
  ];
  const failures = [];
  const triggers = Array.isArray(details.triggers) ? details.triggers : [];

  if (!details.audit_function_exists) {
    failures.push("private.audit_row_change() does not exist.");
  }
  if (!details.audit_logs_table_exists) {
    failures.push("public.audit_logs does not exist.");
  }
  const missingColumns = requiredColumns.filter(
    (column) => details.audit_logs_columns?.[column] !== true
  );
  if (missingColumns.length > 0) {
    failures.push(
      `public.audit_logs is missing columns: ${missingColumns.join(", ")}.`
    );
  }

  for (const table of requiredTables) {
    if (details.tables?.[table] !== true) {
      failures.push(`public.${table} does not exist.`);
      continue;
    }

    const tableTriggers = triggers.filter(
      (trigger) => trigger.table === table
    );
    if (tableTriggers.length === 0) {
      failures.push(
        `public.${table} has no trigger using private.audit_row_change().`
      );
      continue;
    }

    const invalid = tableTriggers.filter(
      (trigger) =>
        trigger.internal ||
        trigger.parent_trigger !== 0 ||
        !trigger.row_level ||
        trigger.before ||
        !trigger.insert ||
        !trigger.update ||
        !trigger.delete ||
        trigger.truncate ||
        !["O", "A"].includes(trigger.enabled)
    );
    if (invalid.length > 0) {
      failures.push(
        `public.${table} has audit triggers that are disabled, non-row, ` +
          `BEFORE, internal, or do not cover INSERT/UPDATE/DELETE: ` +
          `${invalid.map((trigger) => trigger.name).join(", ")}.`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      "Audit trigger preflight failed; no fixtures were created:\n" +
        failures.map((failure) => `- ${failure}`).join("\n")
    );
  }
  console.log(
    "PASS audit_row_change trigger and audit_logs preflight " +
      `(${triggers.map((trigger) => `${trigger.table}.${trigger.name}`).join(", ")}).`
  );
}

async function captureAuditReference(label, signal) {
  const output = await runSql(
    "select coalesce(max(id), 0)::text from public.audit_logs;",
    `audit-reference-${label}`,
    signal
  );
  if (!/^\d+$/.test(output)) {
    throw new Error(
      `${label}: audit reference query returned an invalid identifier: ${output}`
    );
  }
  return output;
}

function snapshotSql(perfumeIds, previousSnapshots) {
  const previousRecipeIds = Array.from(previousSnapshots.values())
    .filter((snapshot) => snapshot.table === "recipes")
    .map((snapshot) => snapshot.recordId);
  const previousComponentIds = Array.from(previousSnapshots.values())
    .filter((snapshot) => snapshot.table === "recipe_components")
    .map((snapshot) => snapshot.recordId);
  const recipePredicates = [
    `r.perfume_id in (${sqlUuidList(perfumeIds)})`,
  ];
  if (previousRecipeIds.length > 0) {
    recipePredicates.push(`r.id in (${sqlUuidList(previousRecipeIds)})`);
  }
  const componentPredicates = [
    "rc.recipe_id in (select scoped.id from scoped_recipes as scoped)",
  ];
  if (previousComponentIds.length > 0) {
    componentPredicates.push(
      `rc.id in (${sqlUuidList(previousComponentIds)})`
    );
  }

  return `
with scoped_recipes as (
  select r.*
    from public.recipes as r
   where ${recipePredicates.join("\n      or ")}
),
snapshot_rows as (
  select
    'recipes'::text as table_name,
    r.id::text as record_id,
    to_jsonb(r)::text as row_data
  from scoped_recipes as r
  union all
  select
    'recipe_components'::text as table_name,
    rc.id::text as record_id,
    to_jsonb(rc)::text as row_data
  from public.recipe_components as rc
  where ${componentPredicates.join("\n      or ")}
)
select coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', snapshot_rows.table_name,
      'record_id', snapshot_rows.record_id,
      'data', snapshot_rows.row_data
    )
    order by snapshot_rows.table_name, snapshot_rows.record_id
  ),
  '[]'::jsonb
)::text
from snapshot_rows;`;
}

async function captureAuditSnapshots(
  label,
  perfumeIds,
  previousSnapshots,
  signal
) {
  const output = await runSql(
    snapshotSql(perfumeIds, previousSnapshots),
    `audit-snapshot-${label}`,
    signal
  );
  let rows;
  try {
    rows = JSON.parse(output);
  } catch {
    throw new Error(
      `${label}: audit snapshot query returned invalid output: ${output}`
    );
  }
  if (!Array.isArray(rows)) {
    throw new Error(`${label}: audit snapshot query did not return an array.`);
  }

  const snapshots = new Map();
  for (const row of rows) {
    if (
      !row ||
      !["recipes", "recipe_components"].includes(row.table) ||
      typeof row.record_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        row.record_id
      ) ||
      typeof row.data !== "string"
    ) {
      throw new Error(
        `${label}: audit snapshot contains an invalid table, UUID, or row image.`
      );
    }

    const recordId = row.record_id.toLowerCase();
    const key = `${row.table}:${recordId}`;
    if (snapshots.has(key)) {
      throw new Error(
        `${label}: duplicate ${row.table} snapshot for ${recordId}.`
      );
    }
    snapshots.set(key, {
      table: row.table,
      recordId,
      data: row.data,
    });
  }
  return snapshots;
}

async function captureAuditBaseline(label, perfumeIds, signal) {
  const snapshots = await captureAuditSnapshots(
    `${label} before`,
    perfumeIds,
    new Map(),
    signal
  );
  const reference = await captureAuditReference(label, signal);
  return { reference, snapshots };
}

function fixtureAuditScopeSql(reference, perfumeIds, snapshots) {
  const recipeIds = Array.from(snapshots.values())
    .filter((snapshot) => snapshot.table === "recipes")
    .map((snapshot) => snapshot.recordId);
  const componentIds = Array.from(snapshots.values())
    .filter((snapshot) => snapshot.table === "recipe_components")
    .map((snapshot) => snapshot.recordId);
  const scenarioRecipeIds = [
    `select r.id::text from public.recipes as r ` +
      `where r.perfume_id in (${sqlUuidList(perfumeIds)})`,
    ...recipeIds.map((recipeId) => `select ${sqlLiteral(recipeId)}::text`),
    `select recipe_audit.record_id ` +
      `from public.audit_logs as recipe_audit ` +
      `where recipe_audit.id > ${reference} ` +
      `and recipe_audit.table_name = 'recipes' ` +
      `and (recipe_audit.old_data ->> 'perfume_id' in (${sqlTextList(perfumeIds)}) ` +
      `or recipe_audit.new_data ->> 'perfume_id' in (${sqlTextList(perfumeIds)}))`,
  ].join("\nunion\n");
  const componentRecordScope =
    componentIds.length > 0
      ? `al.record_id in (${sqlTextList(componentIds)})\n      or `
      : "";

  return `(
    al.table_name = 'recipes'
    and (
      al.record_id in (${scenarioRecipeIds})
      or al.old_data ->> 'perfume_id' in (${sqlTextList(perfumeIds)})
      or al.new_data ->> 'perfume_id' in (${sqlTextList(perfumeIds)})
    )
  )
  or (
    al.table_name = 'recipe_components'
    and (
      ${componentRecordScope}al.old_data ->> 'recipe_id' in (${scenarioRecipeIds})
      or al.new_data ->> 'recipe_id' in (${scenarioRecipeIds})
    )
  )`;
}

function auditEventsSql(reference, perfumeIds, snapshots) {
  return `
select coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', al.table_name,
      'action', al.action,
      'actor_type', al.actor_type,
      'actor_id', al.actor_id::text,
      'record_id', al.record_id,
      'old_data', al.old_data::text,
      'new_data', al.new_data::text
    )
  ),
  '[]'::jsonb
)
from public.audit_logs as al
where al.id > ${reference}
  and (${fixtureAuditScopeSql(reference, perfumeIds, snapshots)});`;
}

function expectedAuditEvents(beforeSnapshots, afterSnapshots) {
  const expected = [];
  const keys = new Set([...beforeSnapshots.keys(), ...afterSnapshots.keys()]);
  for (const key of keys) {
    const before = beforeSnapshots.get(key);
    const after = afterSnapshots.get(key);
    if (!before && after) {
      expected.push({
        table: after.table,
        action: "INSERT",
        actor_type: "user",
        actor_id: fixture.adminId,
        record_id: after.recordId,
        old_data: null,
        new_data: after.data,
      });
    } else if (before && !after) {
      expected.push({
        table: before.table,
        action: "DELETE",
        actor_type: "user",
        actor_id: fixture.adminId,
        record_id: before.recordId,
        old_data: before.data,
        new_data: null,
      });
    } else if (before && after && before.data !== after.data) {
      expected.push({
        table: before.table,
        action: "UPDATE",
        actor_type: "user",
        actor_id: fixture.adminId,
        record_id: before.recordId,
        old_data: before.data,
        new_data: after.data,
      });
    }
  }
  return expected;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function auditEventDiff(expected, actual) {
  const expectedCounts = new Map();
  const actualCounts = new Map();
  for (const event of expected) {
    const key = canonicalJson(event);
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }
  for (const event of actual) {
    const key = canonicalJson(event);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }

  const missing = [];
  const unexpected = [];
  for (const [key, count] of expectedCounts) {
    const difference = count - (actualCounts.get(key) ?? 0);
    if (difference > 0) {
      missing.push({ count: difference, event: JSON.parse(key) });
    }
  }
  for (const [key, count] of actualCounts) {
    const difference = count - (expectedCounts.get(key) ?? 0);
    if (difference > 0) {
      unexpected.push({ count: difference, event: JSON.parse(key) });
    }
  }
  return { missing, unexpected };
}

async function assertAuditEvents(
  label,
  reference,
  perfumeIds,
  beforeSnapshots,
  afterSnapshots,
  signal
) {
  const allSnapshots = new Map([...beforeSnapshots, ...afterSnapshots]);
  const output = await runSql(
    auditEventsSql(reference, perfumeIds, allSnapshots),
    `verify-audit-${label}`,
    signal
  );

  let actual;
  try {
    actual = JSON.parse(output);
  } catch {
    throw new Error(`${label}: audit query returned invalid output: ${output}`);
  }
  if (!Array.isArray(actual)) {
    throw new Error(`${label}: audit query did not return an array.`);
  }

  const invalidEvents = actual.filter(
    (event) =>
      !event ||
      !["recipes", "recipe_components"].includes(event.table) ||
      !["INSERT", "UPDATE", "DELETE"].includes(event.action) ||
      typeof event.record_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        event.record_id
      ) ||
      !(event.old_data === null || typeof event.old_data === "string") ||
      !(event.new_data === null || typeof event.new_data === "string")
  );
  if (invalidEvents.length > 0) {
    throw new Error(
      `${label}: audit query returned malformed row events:\n` +
        JSON.stringify(invalidEvents, null, 2)
    );
  }

  const wrongActors = actual.filter(
    (event) =>
      event.actor_type !== "user" || event.actor_id !== fixture.adminId
  );
  if (wrongActors.length > 0) {
    throw new Error(
      `${label}: unexpected audit actor or actor type:\n` +
        JSON.stringify(wrongActors, null, 2)
    );
  }

  const { missing, unexpected } = auditEventDiff(
    expectedAuditEvents(beforeSnapshots, afterSnapshots),
    actual
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label}: audit events do not match complete row snapshots ` +
        `(after audit id ${reference}).\n` +
        `Missing:\n${JSON.stringify(missing, null, 2)}\n` +
        `Unexpected:\n${JSON.stringify(unexpected, null, 2)}`
    );
  }
  console.log(
    `PASS ${label}: ${actual.length} complete audit event(s) verified.`
  );
}

function transactionSql(appName, body, hold = false) {
  return `
set application_name = ${sqlLiteral(appName)};
set lock_timeout = '${LOCK_TIMEOUT_MS}ms';
set statement_timeout = '${STATEMENT_TIMEOUT_MS}ms';
begin;
do $maintenance_context$
begin
  if private.system_maintenance_context_valid() then
    raise exception 'Concurrency action connection unexpectedly has maintenance context';
  end if;
end;
$maintenance_context$;
${actorSql()}
${body}
${hold ? `select pg_catalog.pg_sleep(${HOLD_SECONDS});` : ""}
commit;
`;
}

function activityQuery(appName, holdQuery) {
  return `
select case when exists (
  select 1
    from pg_catalog.pg_stat_activity as holder
   where holder.application_name = ${sqlLiteral(appName)}
     and holder.state = 'active'
     and holder.wait_event = 'PgSleep'
     and holder.query like ${sqlLiteral(`%${holdQuery}%`)}
) then 1 else 0 end;`;
}

function matchingAdvisoryWaitQuery(holderApp, waiterApp, holdQuery) {
  return `
select case when exists (
  select 1
    from pg_catalog.pg_stat_activity as holder
    join pg_catalog.pg_locks as held
      on held.pid = holder.pid
     and held.locktype = 'advisory'
     and held.granted
    join pg_catalog.pg_stat_activity as waiter
      on waiter.application_name = ${sqlLiteral(waiterApp)}
     and waiter.state = 'active'
     and waiter.wait_event_type = 'Lock'
     and waiter.wait_event = 'advisory'
    join pg_catalog.pg_locks as waiting
      on waiting.pid = waiter.pid
     and waiting.locktype = 'advisory'
     and not waiting.granted
     and waiting.database = held.database
     and waiting.classid = held.classid
     and waiting.objid = held.objid
     and waiting.objsubid = held.objsubid
   where holder.application_name = ${sqlLiteral(holderApp)}
     and holder.state = 'active'
     and holder.wait_event = 'PgSleep'
     and holder.query like ${sqlLiteral(`%${holdQuery}%`)}
     and pg_catalog.pg_blocking_pids(waiter.pid) @> array[holder.pid]
) then 1 else 0 end;`;
}

async function waitForActivity(
  sql,
  label,
  { signal, failIfSettled, timeoutMs = OBSERVATION_TIMEOUT_MS }
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error(
        `${label}: aborted: ${signal.reason?.message ?? "timeout"}`
      );
    }

    if (failIfSettled) {
      const settled = await Promise.race([
        failIfSettled.then(
          (outcome) => ({ settled: true, outcome }),
          (error) => ({ settled: true, error })
        ),
        delay(0).then(() => ({ settled: false })),
      ]);
      if (settled.settled) {
        if (settled.error) {
          throw new Error(`${label}: peer process ended early: ${settled.error}`);
        }
        throw new Error(`${label}: peer process ended before synchronization.`);
      }
    }

    const remaining = deadline - Date.now();
    const result = await runPsql(
      [
        "-q",
        "-t",
        "-A",
        "--command",
        `set statement_timeout = '3s'; ${sql}`,
      ],
      `recipe-concurrency-observer-${label}`,
      `${label} observer`,
      {
        timeoutMs: Math.min(OBSERVER_TIMEOUT_MS, remaining),
        signal,
      }
    );
    assertProcessSucceeded(result, `${label} observer`);
    if (result.stdout.trim() === "1") {
      return;
    }
    await delay(100);
  }
  throw new Error(`${label}: observation timeout after ${timeoutMs} ms.`);
}

async function runRace({
  name,
  firstBody,
  secondBody,
  secondMustFail = false,
  expectedError,
  captureRecipe,
}, parentSignal) {
  const localController = new AbortController();
  const signal = AbortSignal.any([parentSignal, localController.signal]);
  const firstApp = `recipe-race-${name}-first`;
  const secondApp = `recipe-race-${name}-second`;
  const holdQuery = `pg_sleep(${HOLD_SECONDS})`;
  let timedOut = false;
  let firstOutcome;
  let secondOutcome;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    localController.abort(new Error(`scenario timeout after ${SCENARIO_TIMEOUT_MS} ms`));
  }, SCENARIO_TIMEOUT_MS);

  try {
    const firstFile = await writeSql(
      `${name}-first`,
      transactionSql(firstApp, firstBody, true)
    );
    const secondFile = await writeSql(
      `${name}-second`,
      transactionSql(secondApp, secondBody)
    );

    const firstPromise = runPsql(
      ["--file", firstFile],
      firstApp,
      `${name}: first connection`,
      { timeoutMs: PROCESS_TIMEOUT_MS, signal }
    );
    firstOutcome = firstPromise.then(
      (result) => ({ result }),
      (error) => ({ error })
    );

    await waitForActivity(
      activityQuery(firstApp, holdQuery),
      `${name}: first transaction holding its locks`,
      { signal, failIfSettled: firstOutcome }
    );

    const secondPromise = runPsql(
      ["--file", secondFile],
      secondApp,
      `${name}: second connection`,
      {
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal,
        captureRecipe,
      }
    );
    secondOutcome = secondPromise.then(
      (result) => ({ result }),
      (error) => ({ error })
    );

    await waitForActivity(
      matchingAdvisoryWaitQuery(firstApp, secondApp, holdQuery),
      `${name}: second transaction waiting on the same recipe advisory lock`,
      { signal, failIfSettled: secondOutcome }
    );

    const [firstSettled, secondSettled] = await Promise.all([
      firstOutcome,
      secondOutcome,
    ]);
    if (firstSettled.error) {
      throw firstSettled.error;
    }
    if (secondSettled.error) {
      throw secondSettled.error;
    }

    assertProcessSucceeded(firstSettled.result, `${name}: first transaction`);
    if (secondMustFail) {
      const combinedOutput =
        `${secondSettled.result.stdout}\n${secondSettled.result.stderr}`;
      if (
        secondSettled.result.code === 0 ||
        !combinedOutput.includes(
          expectedError ?? "Only draft recipe versions can be edited"
        )
      ) {
        throw new Error(
          `${name}: expected the second transaction to reject with ` +
            `"${expectedError ?? "Only draft recipe versions can be edited"}":\n` +
            `${combinedOutput}`
        );
      }
    } else {
      assertProcessSucceeded(secondSettled.result, `${name}: second transaction`);
    }

    if (
      captureRecipe &&
      !dynamicRecipes.has(captureRecipe.scenario)
    ) {
      throw new Error(
        `${name}: did not capture the UUID returned by create_recipe_version.`
      );
    }
    console.log(
      `PASS ${name}: independent sessions synchronized on the same advisory lock.`
    );
  } catch (error) {
    localController.abort(error);
    throw new Error(
      `${name}${timedOut ? `: scenario timeout after ${SCENARIO_TIMEOUT_MS} ms` : ""}: ` +
        `${error.message}`
    );
  } finally {
    clearTimeout(timeoutHandle);
    if (signal.aborted) {
      localController.abort(signal.reason);
    }
    await Promise.all(
      [firstOutcome, secondOutcome]
        .filter(Boolean)
        .map((outcome) => outcome.then(() => undefined))
    );
  }
}

function setupSql() {
  const now = "now()";
  const user = fixture.adminId;
  const perfumeRows = fixture.perfumeIds
    .map(
      (id, index) =>
        `(${sqlLiteral(id)}, ${sqlLiteral(`Recipe concurrency ${id}`)}, ` +
        `${sqlLiteral(`Concurrency ${index} ${id}`)}, true)`
    )
    .join(",\n");
  const materialRows = [
    `(${sqlLiteral(fixture.essenceId)}, ${sqlLiteral(`Concurrency essence ${fixture.essenceId}`)}, 'g', 'essence', null, null, true)`,
    ...fixture.bottleIds.map(
      (id) =>
        `(${sqlLiteral(id)}, ${sqlLiteral(`Concurrency bottle ${id}`)}, ` +
        `'unit', 'bottle', null, 30, true)`
    ),
  ].join(",\n");
  const recipeRows = fixture.recipeIds
    .map(
      (id, index) =>
        `(${sqlLiteral(id)}, ${sqlLiteral(fixture.perfumeIds[index])}, ` +
        `30, 1, 'draft', 1000, ${sqlLiteral(user)})`
    )
    .join(",\n");
  const componentRows = fixture.recipeIds
    .flatMap((recipeId, index) => [
      `(${sqlLiteral(recipeId)}, ${sqlLiteral(fixture.essenceId)}, 'fixed', 1)`,
      `(${sqlLiteral(recipeId)}, ${sqlLiteral(fixture.bottleIds[index])}, 'fixed', 1)`,
    ])
    .join(",\n");

  return `
set lock_timeout = '${LOCK_TIMEOUT_MS}ms';
set statement_timeout = '${STATEMENT_TIMEOUT_MS}ms';
begin;
select private.begin_system_maintenance(
  'Bootstrap recipe concurrency test fixtures'
);
do $maintenance_context$
begin
  if auth.uid() is not null
     or not private.system_maintenance_context_valid() then
    raise exception 'Recipe concurrency bootstrap maintenance context is invalid';
  end if;
end;
$maintenance_context$;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  ${sqlLiteral(user)}, 'authenticated', 'authenticated',
  ${sqlLiteral(`recipe-concurrency-${user}@example.test`)}, '',
  ${now}, '{"provider":"email","providers":["email"]}', '{}', ${now}, ${now}
);
insert into public.profiles (id, role, display_name)
values (${sqlLiteral(user)}, 'admin', ${sqlLiteral(`Concurrency ${user}`)});
do $fixture_admin$
begin
  if not exists (
    select 1
      from auth.users as u
      join public.profiles as p on p.id = u.id
     where u.id = ${sqlLiteral(user)}::uuid
       and p.role = 'admin'::public.app_role
       and p.display_name = ${sqlLiteral(`Concurrency ${user}`)}
  ) then
    raise exception 'Recipe concurrency administrator fixture was not created';
  end if;
end;
$fixture_admin$;
insert into public.perfumes (id, name, brand, active)
values ${perfumeRows};
insert into public.materials (
  id, name, base_unit, category, perfume_id, size_ml, active
)
values ${materialRows};
insert into public.recipes (
  id, perfume_id, size_ml, version, status, price_cop, created_by
)
values ${recipeRows};
insert into public.recipe_components (recipe_id, material_id, mode, quantity)
values ${componentRows};
select private.end_system_maintenance();
do $maintenance_context_closed$
begin
  if private.system_maintenance_context_valid() then
    raise exception 'Recipe concurrency bootstrap left maintenance context active';
  end if;
end;
$maintenance_context_closed$;
commit;
\\echo FIXTURE_SETUP_COMPLETED
`;
}

function versionBody(recipeId) {
  return `select public.create_recipe_version(${sqlLiteral(recipeId)}) as created_recipe_id \\gset
\\echo CREATED_RECIPE_ID=:created_recipe_id`;
}

function assertRecipeVersions(perfumeId, expected, activeCount, label) {
  const expectedRows = expected
    .map(
      (recipe) => `
  if not exists (
    select 1 from public.recipes
     where id = ${sqlLiteral(recipe.id)}::uuid
       and perfume_id = ${sqlLiteral(perfumeId)}::uuid
       and version = ${recipe.version}
       and status = ${sqlLiteral(recipe.status)}::public.recipe_status
       and price_cop = ${recipe.price}
  ) then
    raise exception '${label}: unexpected recipe version or state';
  end if;`
    )
    .join("\n");
  return `
if (select count(*) from public.recipes
     where perfume_id = ${sqlLiteral(perfumeId)}::uuid) <> ${expected.length} then
  raise exception '${label}: unexpected number of recipe versions';
end if;
if (select count(*) from public.recipes
     where perfume_id = ${sqlLiteral(perfumeId)}::uuid
       and status = 'active') <> ${activeCount} then
  raise exception '${label}: unexpected number of active versions';
end if;
${expectedRows}`;
}

function assertComponentSet(recipeId, expected, label) {
  const expectedRows = expected
    .map(
      (component) => `
  if not exists (
    select 1 from public.recipe_components
     where recipe_id = ${sqlLiteral(recipeId)}::uuid
       and material_id = ${sqlLiteral(component.materialId)}::uuid
       and mode = ${sqlLiteral(component.mode)}::public.component_mode
       and quantity is not distinct from ${component.quantity ?? "null"}::numeric
  ) then
    raise exception '${label}: expected component is missing or changed';
  end if;`
    )
    .join("\n");
  return `
if (select count(*) from public.recipe_components
     where recipe_id = ${sqlLiteral(recipeId)}::uuid) <> ${expected.length} then
  raise exception '${label}: unexpected component count';
end if;
${expectedRows}`;
}

async function assertScenario(label, assertions, signal) {
  await runSql(
    `do $assert$ begin\n${assertions}\nend; $assert$;`,
    `verify-${label}`,
    signal
  );
  console.log(`PASS ${label}: final recipe and component state verified.`);
}

async function main(signal) {
  await checkSecurityDefinerPreflight(signal);
  await checkAuditTriggerPreflight(signal);

  const setupFile = await writeSql("setup", setupSql());
  const setup = await runPsql(
    ["--file", setupFile],
    "recipe-concurrency-fixture-setup",
    "fixture setup",
    { timeoutMs: PROCESS_TIMEOUT_MS, signal }
  );
  if (setup.stdout.includes("FIXTURE_SETUP_COMPLETED")) {
    fixtureSetupCompleted = true;
  }
  assertProcessSucceeded(setup, "fixture setup");
  if (!fixtureSetupCompleted) {
    throw new Error("Fixture setup did not confirm its transaction commit.");
  }

  const [
    updateRecipe,
    deleteRecipe,
    updateFirstRecipe,
    deleteFirstRecipe,
    saveRecipe,
    activateRecipe,
    moveActiveSource,
    moveActiveTarget,
    moveDraftSource,
    moveDraftTarget,
  ] = fixture.recipeIds;
  const essence = fixture.essenceId;
  const material = (index) => fixture.bottleIds[index];
  const basePrice = 1000;

  const auditBaseline1 = await captureAuditBaseline(
    "scenario 1",
    [fixture.perfumeIds[0]],
    signal
  );
  await runRace(
    {
      name: "activation-before-component-update",
      firstBody: `select public.activate_recipe(${sqlLiteral(updateRecipe)});`,
      secondBody: `update public.recipe_components
                      set quantity = quantity + 1
                    where recipe_id = ${sqlLiteral(updateRecipe)}
                      and material_id = ${sqlLiteral(essence)};`,
      secondMustFail: true,
    },
    signal
  );
  const auditAfter1 = await captureAuditSnapshots(
    "scenario 1 after",
    [fixture.perfumeIds[0]],
    auditBaseline1.snapshots,
    signal
  );
  await assertScenario(
    "activation-before-component-update",
    assertRecipeVersions(
      fixture.perfumeIds[0],
      [{ id: updateRecipe, version: 1, status: "active", price: basePrice }],
      1,
      "scenario 1"
    ) +
      assertComponentSet(
        updateRecipe,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(0), mode: "fixed", quantity: 1 },
        ],
        "scenario 1"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 1",
    auditBaseline1.reference,
    [fixture.perfumeIds[0]],
    auditBaseline1.snapshots,
    auditAfter1,
    signal
  );

  const auditBaseline2 = await captureAuditBaseline(
    "scenario 2",
    [fixture.perfumeIds[1]],
    signal
  );
  await runRace(
    {
      name: "activation-before-component-delete",
      firstBody: `select public.activate_recipe(${sqlLiteral(deleteRecipe)});`,
      secondBody: `delete from public.recipe_components
                    where recipe_id = ${sqlLiteral(deleteRecipe)}
                      and material_id = ${sqlLiteral(essence)};`,
      secondMustFail: true,
    },
    signal
  );
  const auditAfter2 = await captureAuditSnapshots(
    "scenario 2 after",
    [fixture.perfumeIds[1]],
    auditBaseline2.snapshots,
    signal
  );
  await assertScenario(
    "activation-before-component-delete",
    assertRecipeVersions(
      fixture.perfumeIds[1],
      [{ id: deleteRecipe, version: 1, status: "active", price: basePrice }],
      1,
      "scenario 2"
    ) +
      assertComponentSet(
        deleteRecipe,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(1), mode: "fixed", quantity: 1 },
        ],
        "scenario 2"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 2",
    auditBaseline2.reference,
    [fixture.perfumeIds[1]],
    auditBaseline2.snapshots,
    auditAfter2,
    signal
  );

  const auditBaseline3 = await captureAuditBaseline(
    "scenario 3",
    [fixture.perfumeIds[2]],
    signal
  );
  await runRace(
    {
      name: "component-update-before-activation",
      firstBody: `update public.recipe_components
                     set quantity = quantity + 1
                   where recipe_id = ${sqlLiteral(updateFirstRecipe)}
                     and material_id = ${sqlLiteral(essence)};`,
      secondBody: `select public.activate_recipe(${sqlLiteral(updateFirstRecipe)});`,
    },
    signal
  );
  const auditAfter3 = await captureAuditSnapshots(
    "scenario 3 after",
    [fixture.perfumeIds[2]],
    auditBaseline3.snapshots,
    signal
  );
  await assertScenario(
    "component-update-before-activation",
    assertRecipeVersions(
      fixture.perfumeIds[2],
      [
        {
          id: updateFirstRecipe,
          version: 1,
          status: "active",
          price: basePrice,
        },
      ],
      1,
      "scenario 3"
    ) +
      assertComponentSet(
        updateFirstRecipe,
        [
          { materialId: essence, mode: "fixed", quantity: 2 },
          { materialId: material(2), mode: "fixed", quantity: 1 },
        ],
        "scenario 3"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 3",
    auditBaseline3.reference,
    [fixture.perfumeIds[2]],
    auditBaseline3.snapshots,
    auditAfter3,
    signal
  );

  const auditBaseline4 = await captureAuditBaseline(
    "scenario 4",
    [fixture.perfumeIds[3]],
    signal
  );
  await runRace(
    {
      name: "component-delete-before-activation",
      firstBody: `delete from public.recipe_components
                   where recipe_id = ${sqlLiteral(deleteFirstRecipe)}
                     and material_id = ${sqlLiteral(essence)};`,
      secondBody: `select public.activate_recipe(${sqlLiteral(deleteFirstRecipe)});`,
    },
    signal
  );
  const auditAfter4 = await captureAuditSnapshots(
    "scenario 4 after",
    [fixture.perfumeIds[3]],
    auditBaseline4.snapshots,
    signal
  );
  await assertScenario(
    "component-delete-before-activation",
    assertRecipeVersions(
      fixture.perfumeIds[3],
      [
        {
          id: deleteFirstRecipe,
          version: 1,
          status: "active",
          price: basePrice,
        },
      ],
      1,
      "scenario 4"
    ) +
      assertComponentSet(
        deleteFirstRecipe,
        [{ materialId: material(3), mode: "fixed", quantity: 1 }],
        "scenario 4"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 4",
    auditBaseline4.reference,
    [fixture.perfumeIds[3]],
    auditBaseline4.snapshots,
    auditAfter4,
    signal
  );

  const replacement = JSON.stringify([
    { material_id: essence, mode: "fixed", quantity: 2 },
    { material_id: material(4), mode: "fixed", quantity: 1 },
  ]);
  const auditBaseline5 = await captureAuditBaseline(
    "scenario 5",
    [fixture.perfumeIds[4]],
    signal
  );
  await runRace(
    {
      name: "admin-save-before-create-version",
      firstBody: `select public.admin_save_recipe(
        ${sqlLiteral(saveRecipe)}, ${sqlLiteral(fixture.perfumeIds[4])},
        30, 1200, ${sqlLiteral(replacement)}::jsonb
      );`,
      secondBody: versionBody(saveRecipe),
      captureRecipe: {
        scenario: "admin-save-before-create-version",
        perfumeId: fixture.perfumeIds[4],
      },
    },
    signal
  );
  const auditAfter5 = await captureAuditSnapshots(
    "scenario 5 after",
    [fixture.perfumeIds[4]],
    auditBaseline5.snapshots,
    signal
  );
  const savedVersion = dynamicRecipes.get("admin-save-before-create-version");
  await assertScenario(
    "admin-save-before-create-version",
    assertRecipeVersions(
      fixture.perfumeIds[4],
      [
        { id: saveRecipe, version: 1, status: "draft", price: 1200 },
        { id: savedVersion.id, version: 2, status: "draft", price: 1200 },
      ],
      0,
      "scenario 5"
    ) +
      assertComponentSet(
        saveRecipe,
        [
          { materialId: essence, mode: "fixed", quantity: 2 },
          { materialId: material(4), mode: "fixed", quantity: 1 },
        ],
        "scenario 5 source"
      ) +
      assertComponentSet(
        savedVersion.id,
        [
          { materialId: essence, mode: "fixed", quantity: 2 },
          { materialId: material(4), mode: "fixed", quantity: 1 },
        ],
        "scenario 5 created version"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 5",
    auditBaseline5.reference,
    [fixture.perfumeIds[4]],
    auditBaseline5.snapshots,
    auditAfter5,
    signal
  );

  const auditBaseline6 = await captureAuditBaseline(
    "scenario 6",
    [fixture.perfumeIds[5]],
    signal
  );
  await runRace(
    {
      name: "activation-before-create-version",
      firstBody: `select public.activate_recipe(${sqlLiteral(activateRecipe)});`,
      secondBody: versionBody(activateRecipe),
      captureRecipe: {
        scenario: "activation-before-create-version",
        perfumeId: fixture.perfumeIds[5],
      },
    },
    signal
  );
  const auditAfter6 = await captureAuditSnapshots(
    "scenario 6 after",
    [fixture.perfumeIds[5]],
    auditBaseline6.snapshots,
    signal
  );
  const activatedVersion = dynamicRecipes.get("activation-before-create-version");
  await assertScenario(
    "activation-before-create-version",
    assertRecipeVersions(
      fixture.perfumeIds[5],
      [
        { id: activateRecipe, version: 1, status: "active", price: basePrice },
        {
          id: activatedVersion.id,
          version: 2,
          status: "draft",
          price: basePrice,
        },
      ],
      1,
      "scenario 6"
    ) +
      assertComponentSet(
        activateRecipe,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(5), mode: "fixed", quantity: 1 },
        ],
        "scenario 6 source"
      ) +
      assertComponentSet(
        activatedVersion.id,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(5), mode: "fixed", quantity: 1 },
        ],
        "scenario 6 created version"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 6",
    auditBaseline6.reference,
    [fixture.perfumeIds[5]],
    auditBaseline6.snapshots,
    auditAfter6,
    signal
  );

  const auditBaseline7A = await captureAuditBaseline(
    "scenario 7A",
    [fixture.perfumeIds[6], fixture.perfumeIds[7]],
    signal
  );
  await runRace(
    {
      name: "move-active-recipe-before-draft",
      firstBody: `select public.activate_recipe(${sqlLiteral(moveActiveSource)});`,
      secondBody: `update public.recipe_components
                      set recipe_id = ${sqlLiteral(moveActiveTarget)}
                    where recipe_id = ${sqlLiteral(moveActiveSource)}
                      and material_id = ${sqlLiteral(material(6))};`,
      secondMustFail: true,
    },
    signal
  );
  const auditAfter7A = await captureAuditSnapshots(
    "scenario 7A after",
    [fixture.perfumeIds[6], fixture.perfumeIds[7]],
    auditBaseline7A.snapshots,
    signal
  );
  await assertScenario(
    "move-active-recipe-before-draft",
    assertRecipeVersions(
      fixture.perfumeIds[6],
      [{ id: moveActiveSource, version: 1, status: "active", price: basePrice }],
      1,
      "scenario 7A source"
    ) +
      assertRecipeVersions(
        fixture.perfumeIds[7],
        [{ id: moveActiveTarget, version: 1, status: "draft", price: basePrice }],
        0,
        "scenario 7A target"
      ) +
      assertComponentSet(
        moveActiveSource,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(6), mode: "fixed", quantity: 1 },
        ],
        "scenario 7A source"
      ) +
      assertComponentSet(
        moveActiveTarget,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(7), mode: "fixed", quantity: 1 },
        ],
        "scenario 7A target"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 7A",
    auditBaseline7A.reference,
    [fixture.perfumeIds[6], fixture.perfumeIds[7]],
    auditBaseline7A.snapshots,
    auditAfter7A,
    signal
  );

  const auditBaseline7B = await captureAuditBaseline(
    "scenario 7B",
    [fixture.perfumeIds[8], fixture.perfumeIds[9]],
    signal
  );
  await runRace(
    {
      name: "move-draft-before-activation",
      firstBody: `update public.recipe_components
                    set recipe_id = ${sqlLiteral(moveDraftTarget)}
                  where recipe_id = ${sqlLiteral(moveDraftSource)}
                    and material_id = ${sqlLiteral(material(8))};`,
      secondBody: `select public.activate_recipe(${sqlLiteral(moveDraftSource)});`,
      secondMustFail: true,
      expectedError:
        "An active recipe requires exactly one fixed bottle matching its presentation",
    },
    signal
  );
  const auditAfter7B = await captureAuditSnapshots(
    "scenario 7B after",
    [fixture.perfumeIds[8], fixture.perfumeIds[9]],
    auditBaseline7B.snapshots,
    signal
  );
  await assertScenario(
    "move-draft-before-activation",
    assertRecipeVersions(
      fixture.perfumeIds[8],
      [{ id: moveDraftSource, version: 1, status: "draft", price: basePrice }],
      0,
      "scenario 7B source"
    ) +
      assertRecipeVersions(
        fixture.perfumeIds[9],
        [{ id: moveDraftTarget, version: 1, status: "draft", price: basePrice }],
        0,
        "scenario 7B target"
      ) +
      assertComponentSet(
        moveDraftSource,
        [{ materialId: essence, mode: "fixed", quantity: 1 }],
        "scenario 7B source"
      ) +
      assertComponentSet(
        moveDraftTarget,
        [
          { materialId: essence, mode: "fixed", quantity: 1 },
          { materialId: material(9), mode: "fixed", quantity: 1 },
          { materialId: material(8), mode: "fixed", quantity: 1 },
        ],
        "scenario 7B target"
      ),
    signal
  );
  await assertAuditEvents(
    "scenario 7B",
    auditBaseline7B.reference,
    [fixture.perfumeIds[8], fixture.perfumeIds[9]],
    auditBaseline7B.snapshots,
    auditAfter7B,
    signal
  );
}

function fixtureOwnershipConditionSql() {
  const adminId = sqlLiteral(fixture.adminId);
  const staticRecipeIds = Array.from(recipeIdsByScenario.values()).flat();
  const perfumeIds = sqlUuidList(fixture.perfumeIds);
  const materialIds = sqlUuidList([fixture.essenceId, ...fixture.bottleIds]);
  const staticRecipePairs = fixture.recipeIds
    .map(
      (recipeId, index) =>
        `(${sqlLiteral(recipeId)}::uuid, ${sqlLiteral(fixture.perfumeIds[index])}::uuid)`
    )
    .join(",\n    ");
  const dynamicEntries = Array.from(dynamicRecipes.values());
  const dynamicIds = dynamicEntries.map((entry) => entry.id);
  const dynamicCheck =
    dynamicEntries.length === 0
      ? "true"
      : dynamicEntries
          .map(
            (entry) => `
            exists (
              select 1 from public.recipes
               where id = ${sqlLiteral(entry.id)}::uuid
                 and perfume_id = ${sqlLiteral(entry.perfumeId)}::uuid
                 and created_by = ${adminId}::uuid
            )`
          )
          .join(" and ");

  return `
  (select count(*) from auth.users
    where id = ${adminId}::uuid
      and email = ${sqlLiteral(`recipe-concurrency-${fixture.adminId}@example.test`)}) = 1
  and (select count(*) from public.profiles
    where id = ${adminId}::uuid
      and role = 'admin'::public.app_role
      and display_name = ${sqlLiteral(`Concurrency ${fixture.adminId}`)}) = 1
  and (select count(*) from public.perfumes as p
    where p.id in (${perfumeIds})
      and p.name = ('Recipe concurrency ' || p.id::text)) = ${fixture.perfumeIds.length}
  and (select count(*) from public.materials as m
    where m.id in (${materialIds})
      and (
        (
          m.id = ${sqlLiteral(fixture.essenceId)}::uuid
          and m.name = ('Concurrency essence ' || m.id::text)
          and m.category = 'essence'
        )
        or (
          m.id <> ${sqlLiteral(fixture.essenceId)}::uuid
          and m.name = ('Concurrency bottle ' || m.id::text)
          and m.category = 'bottle'
        )
      )) = ${fixture.bottleIds.length + 1}
  and (select count(*) from public.recipes as r
    join (values
    ${staticRecipePairs}
    ) as expected(id, perfume_id)
      on expected.id = r.id
    where r.created_by = ${adminId}::uuid
      and r.perfume_id = expected.perfume_id) = ${staticRecipeIds.length}
  and (select count(*) from public.recipes
    where perfume_id in (${perfumeIds})) = ${
      staticRecipeIds.length + dynamicIds.length
    }
  and ${dynamicCheck}
`;
}

function fixtureOwnershipCheckSql() {
  return `select case when ${fixtureOwnershipConditionSql()} then 1 else 0 end;`;
}

function componentCleanupBlock(recipeIds) {
  return `
do $component_cleanup$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), array[]::uuid[])
    into v_ids
    from public.recipe_components
   where recipe_id in (${sqlUuidList(recipeIds)});
  if cardinality(v_ids) > 0 then
    delete from public.recipe_components where id = any(v_ids);
  end if;
end;
$component_cleanup$;`;
}

function auditLogCleanupBlock() {
  const adminId = sqlLiteral(fixture.adminId);
  const perfumeIds = fixture.perfumeIds.map(sqlLiteral).join(", ");
  const materialIds = [fixture.essenceId, ...fixture.bottleIds]
    .map(sqlLiteral)
    .join(", ");
  const recipeIds = allKnownRecipeIds().map(sqlLiteral).join(", ");

  return `
do $audit_cleanup$
declare
  v_ids bigint[];
begin
  select coalesce(array_agg(al.id), array[]::bigint[])
    into v_ids
    from public.audit_logs as al
   where (
     al.table_name = 'profiles'
     and al.record_id = ${adminId}
   )
   or (
     al.table_name = 'perfumes'
     and al.record_id in (${perfumeIds})
   )
   or (
     al.table_name = 'materials'
     and al.record_id in (${materialIds})
   )
   or (
     al.table_name = 'recipes'
     and al.record_id in (${recipeIds})
   )
   or (
     al.table_name = 'recipe_components'
     and (
       al.old_data ->> 'recipe_id' in (${recipeIds})
       or al.new_data ->> 'recipe_id' in (${recipeIds})
     )
   );
  if cardinality(v_ids) > 0 then
    delete from public.audit_logs where id = any(v_ids);
  end if;
end;
$audit_cleanup$;`;
}

function cleanupSql() {
  const recipeIds = allKnownRecipeIds();
  const recipeIdList = sqlUuidList(recipeIds);
  const perfumeIds = sqlUuidList(fixture.perfumeIds);
  const materialIds = sqlUuidList([fixture.essenceId, ...fixture.bottleIds]);
  return `
set lock_timeout = '10s';
set statement_timeout = '15s';
begin;
do $fixture_owner$
begin
  if not (${fixtureOwnershipConditionSql()}) then
    raise exception 'Fixture ownership could not be verified; refusing cleanup';
  end if;
end;
$fixture_owner$;
do $maintenance_context$
begin
  if private.system_maintenance_context_valid() then
    raise exception 'Recipe concurrency cleanup started with maintenance context active';
  end if;
end;
$maintenance_context$;
${actorSql()}
update public.recipes
   set status = 'archived'
 where id in (${recipeIdList})
   and status = 'active';
update public.recipes
   set status = 'draft'
 where id in (${recipeIdList})
   and status = 'archived';
${componentCleanupBlock(recipeIds)}
delete from public.recipes
 where id in (${recipeIdList});
delete from public.materials
 where id in (${materialIds});
delete from public.perfumes
 where id in (${perfumeIds});
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select private.begin_system_maintenance(
  'Cleanup recipe concurrency test actor'
);
do $cleanup_maintenance_context$
begin
  if auth.uid() is not null
     or not private.system_maintenance_context_valid() then
    raise exception 'Recipe concurrency cleanup maintenance context is invalid';
  end if;
end;
$cleanup_maintenance_context$;
${auditLogCleanupBlock()}
delete from public.profiles
 where id = ${sqlLiteral(fixture.adminId)}::uuid;
do $profile_audit_cleanup$
declare
  v_ids bigint[];
begin
  select coalesce(array_agg(id), array[]::bigint[])
    into v_ids
    from public.audit_logs
   where table_name = 'profiles'
     and record_id = ${sqlLiteral(fixture.adminId)};
  if cardinality(v_ids) > 0 then
    delete from public.audit_logs where id = any(v_ids);
  end if;
end;
$profile_audit_cleanup$;
delete from auth.users
 where id = ${sqlLiteral(fixture.adminId)}::uuid;
select private.end_system_maintenance();
do $cleanup_maintenance_context_closed$
begin
  if private.system_maintenance_context_valid() then
    raise exception 'Recipe concurrency cleanup left maintenance context active';
  end if;
end;
$cleanup_maintenance_context_closed$;
commit;
`;
}

async function cleanup() {
  assertLocalConnectionUnchanged();
  const ownership = await runSql(
    fixtureOwnershipCheckSql(),
    "fixture ownership pre-cleanup check",
    undefined,
    8_000
  );
  if (ownership !== "1") {
    throw new Error(
      "Fixture ownership check failed; no cleanup DELETE was attempted."
    );
  }

  const cleanupFile = await writeSql("cleanup", cleanupSql());
  const result = await runPsql(
    ["--file", cleanupFile],
    "recipe-concurrency-fixture-cleanup",
    "fixture cleanup",
    { timeoutMs: CLEANUP_TIMEOUT_MS }
  );
  assertProcessSucceeded(result, "fixture cleanup");
}

async function terminateAllProcesses() {
  await Promise.all(
    Array.from(runningProcesses, async (child) => {
      if (!isRunning(child)) {
        return;
      }
      child.kill("SIGTERM");
      for (let attempt = 0; attempt < 10 && isRunning(child); attempt += 1) {
        await delay(100);
      }
      if (isRunning(child)) {
        child.kill(process.platform === "win32" ? "SIGTERM" : "SIGKILL");
        for (let attempt = 0; attempt < 10 && isRunning(child); attempt += 1) {
          await delay(100);
        }
      }
      if (isRunning(child)) {
        throw new Error(`Could not terminate psql process ${child.pid}.`);
      }
    })
  );
}

async function runHarness() {
  const workController = new AbortController();
  const workTimer = setTimeout(
    () =>
      workController.abort(
        new Error(`harness work timeout after ${HARNESS_WORK_TIMEOUT_MS} ms`)
      ),
    HARNESS_WORK_TIMEOUT_MS
  );
  let mainError;
  let cleanupError;

  try {
    await main(workController.signal);
  } catch (error) {
    mainError = error;
  } finally {
    clearTimeout(workTimer);
    await terminateAllProcesses();
    if (fixtureSetupCompleted) {
      try {
        await cleanup();
      } catch (error) {
        cleanupError = error;
        console.error(`Controlled fixture cleanup failed: ${error.message}`);
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }

  if (mainError && cleanupError) {
    throw new AggregateError(
      [mainError, cleanupError],
      `Harness failed and controlled cleanup also failed: ${mainError.message}`
    );
  }
  if (mainError) {
    throw mainError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  console.log(
    `Harness completed within its ${HARNESS_TOTAL_TIMEOUT_MS} ms total budget.`
  );
}

await runHarness();
