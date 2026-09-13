import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { AppShell } from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'Margin Memory',
  description: 'Evidence-backed estimate review for small electrical contractors.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>
}
