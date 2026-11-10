import type { LucideIcon } from "lucide-react";

export interface AdminNavigationItem {
  path: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface AdminNavigationGroup {
  label: string;
  items: AdminNavigationItem[];
}
