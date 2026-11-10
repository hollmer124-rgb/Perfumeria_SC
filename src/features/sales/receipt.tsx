import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import type { SaleRecord } from "@/features/sales/types";

const paymentLabels = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
} as const;

export function SaleReceipt({
  sale,
  paymentLabel,
  onClose,
}: {
  sale: SaleRecord;
  paymentLabel?: string;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`Comprobante de venta ${sale.sale_number}`}
      className="printable-receipt mx-auto w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
    >
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .printable-receipt, .printable-receipt * { visibility: visible !important; }
          .printable-receipt {
            position: fixed !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 12mm !important;
            background: white !important;
            color: black !important;
          }
          .receipt-no-print { display: none !important; }
        }
      `}</style>
      <div className="receipt-no-print mb-5 flex justify-end gap-2">
        <Button onClick={() => window.print()} size="sm" variant="outline">
          <Printer aria-hidden="true" size={15} />
          Imprimir
        </Button>
        <Button aria-label="Cerrar comprobante" onClick={onClose} size="icon" variant="ghost">
          <X aria-hidden="true" size={16} />
        </Button>
      </div>
      <header className="border-b border-dashed border-border pb-5 text-center">
        <p className="font-serif text-2xl font-semibold">Perfumeria SC</p>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Comprobante de venta
        </p>
        <p className="mt-4 text-sm font-medium">Venta #{sale.sale_number}</p>
        <p className="text-xs text-muted-foreground">
          {new Intl.DateTimeFormat("es-CO", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/Bogota",
          }).format(new Date(sale.created_at))}
        </p>
      </header>

      <dl className="grid gap-2 border-b border-dashed border-border py-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Cliente</dt>
          <dd>{sale.customer?.full_name ?? "Venta sin cliente"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pago</dt>
          <dd>{paymentLabel ?? paymentLabels[sale.payment_method]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Estado</dt>
          <dd>{sale.status === "completed" ? "Finalizada" : sale.adjustment?.operation === "refund" ? "Devuelta" : "Anulada"}</dd>
        </div>
        {sale.adjustment ? (
          <div>
            <dt className="text-xs text-muted-foreground">Ajuste autorizado</dt>
            <dd>{sale.adjustment.reason}</dd>
          </div>
        ) : null}
      </dl>

      <div className="divide-y divide-dashed divide-border">
        {sale.items.map((item) => (
          <div className="grid grid-cols-[1fr_auto] gap-3 py-3" key={item.id}>
            <div>
              <p className="text-sm font-medium">{item.item_name_snapshot}</p>
              <p className="text-xs text-muted-foreground">
                {formatQuantity(item.quantity)} × {formatCop(item.unit_price_cop)}
                {item.item_type === "recipe" && item.recipe_version_snapshot
                  ? ` · fórmula v${item.recipe_version_snapshot}`
                  : item.product_type_snapshot
                    ? ` · ${item.product_type_snapshot === "original" ? "Original" : "1.1"}`
                    : ""}
              </p>
            </div>
            <p className="text-sm font-medium">{formatCop(item.line_total_cop)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-dashed border-border pt-4 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCop(sale.subtotal_cop)}</span>
        </div>
        {sale.discount_cop > 0 ? (
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>-{formatCop(sale.discount_cop)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
          <span>Total</span>
          <span>{formatCop(sale.total_cop)}</span>
        </div>
        {sale.status === "voided" ? (
          <p className="pt-2 text-center text-xs font-semibold uppercase tracking-widest">
            {sale.adjustment?.operation === "refund" ? "Devolución total" : "Venta anulada"}
          </p>
        ) : null}
      </div>
      <footer className="pt-6 text-center text-xs text-muted-foreground">
        Gracias por tu compra.
      </footer>
    </section>
  );
}
