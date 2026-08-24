import './globals.css';

export const metadata = {
  title: 'Portfolio Tracker',
  description: 'Holdings, cost basis and tax status from the NSDL eCAS',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
