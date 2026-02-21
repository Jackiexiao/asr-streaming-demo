import "./globals.css"

export const metadata = {
  title: "Deepgram Next.js Demo",
  description: "Deepgram 文件识别与流式语音识别演示",
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
