import './globals.css';

export const metadata = {
  title: 'News Pusher | BPC Integration',
  description: 'Automated bypassed news pushed to Telegram',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="dark-mode">{children}</body>
    </html>
  );
}
