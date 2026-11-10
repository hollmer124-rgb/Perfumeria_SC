import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="light"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "border border-border bg-card text-foreground shadow-lg",
          title: "font-medium",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
