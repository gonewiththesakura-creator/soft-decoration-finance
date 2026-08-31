import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "织衡经营财务", template: "%s｜织衡经营财务" },
  description: "以项目为核心的软装采购经营财务系统",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
