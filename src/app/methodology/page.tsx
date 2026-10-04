import type { Metadata } from "next";
import { ClashOfLangsApp } from "@/components/ClashOfLangsApp";

export const metadata: Metadata = { title: "Methodology" };

export default function Page() {
  return <ClashOfLangsApp panel="methodology" />;
}
