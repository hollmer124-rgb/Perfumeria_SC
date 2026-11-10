import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button-variants";

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-medium text-gold">Error 404</p>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        No encontramos esta página
      </h1>
      <p className="mt-3 text-muted-foreground">
        La ruta solicitada no existe o todavía no está disponible.
      </p>
      <Link to="/" className={buttonVariants({ className: "mt-6" })}>
        Volver al panel
      </Link>
    </section>
  );
}
