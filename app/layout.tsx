import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "镜场｜创作者录制台",
  description:
    "把摄像头、屏幕画面和提词脚本放在同一个工作台中，在浏览器本机完成录制。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
