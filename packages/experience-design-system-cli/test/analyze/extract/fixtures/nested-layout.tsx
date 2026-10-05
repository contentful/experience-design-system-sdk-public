import type { ReactElement } from 'react';

export interface HeaderProps {
  title: string;
}
export function Header({ title }: HeaderProps) {
  return <header>{title}</header>;
}

export interface SidebarProps {
  items: string[];
}
export function Sidebar({ items }: SidebarProps) {
  return <aside>{items.join(',')}</aside>;
}

export interface FooterProps {
  copyright: string;
}
export function Footer({ copyright }: FooterProps) {
  return <footer>{copyright}</footer>;
}

export interface LayoutProps {
  header: ReactElement<HeaderProps>;
  sidebar: ReactElement<SidebarProps>;
  footer: ReactElement<FooterProps>;
}

export function Layout({ header, sidebar, footer }: LayoutProps) {
  return (
    <div>
      {header}
      {sidebar}
      <main />
      {footer}
    </div>
  );
}
