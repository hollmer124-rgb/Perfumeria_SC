import { ClipboardList } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function RecentActivity() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Actividad reciente</CardTitle>
          <CardDescription>
            Los movimientos aparecerán aquí cuando se conecten los módulos.
          </CardDescription>
        </div>
        <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground sm:mt-0">
          <span className="size-1.5 rounded-full bg-gold" />
          Sin datos
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Movimiento</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead className="text-right">Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={3} className="h-48 text-center">
                <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ClipboardList aria-hidden="true" size={19} />
                  </span>
                  <p className="text-sm font-medium">Aún no hay actividad</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    No se muestran registros de ejemplo. La actividad real
                    estará disponible cuando se implementen los módulos.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
