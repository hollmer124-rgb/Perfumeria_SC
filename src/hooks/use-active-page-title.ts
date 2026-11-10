import { useLocation } from "react-router-dom";
import { allNavigationItems } from "@/features/navigation/navigation-items";

export function useActivePageTitle() {
  const { pathname } = useLocation();

  return (
    allNavigationItems.find((item) => item.path === pathname)?.title ??
    "Dashboard"
  );
}
