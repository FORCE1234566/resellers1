import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Menu, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import BrandLogo from '@/components/ui/BrandLogo';
const NAV_LINKS = [
  { href: '/#services', label: 'Services' },
  { href: '/#features', label: 'Features' },
  { href: '/#networks', label: 'Networks' },
];

export default function SiteNavbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <nav className="sticky top-0 z-50 bg-navy/95 backdrop-blur-md border-b border-navy-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-16 flex items-center justify-between gap-3">
          <BrandLogo />

          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-gray-300 hover:text-white transition"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-2 sm:gap-3">
            <Link
              to="/login/agent"
              className="text-sm font-medium text-gray-300 hover:text-white px-2 py-2 transition"
            >
              Agent Login
            </Link>
            <Link to="/login/reseller">
              <Button size="sm" variant="primary">Reseller Login</Button>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="md:hidden p-2 text-white hover:text-gold transition shrink-0"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 top-16 bg-black/50 z-40 md:hidden"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="md:hidden absolute left-0 right-0 top-full z-50 bg-navy-light border-b border-navy-border shadow-xl shadow-black/30">
            <ul className="py-2 max-h-[calc(100dvh-4rem)] overflow-y-auto">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="block px-6 py-3.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="border-t border-navy-border mt-2 pt-2 px-4 pb-4 space-y-2">
                <Link to="/login/agent" onClick={() => setMenuOpen(false)} className="block">
                  <Button variant="outline" className="w-full">Agent Login</Button>
                </Link>
                <Link to="/login/reseller" onClick={() => setMenuOpen(false)} className="block">
                  <Button className="w-full">Reseller Login</Button>
                </Link>
              </li>
            </ul>
          </div>
        </>
      )}
    </nav>
  );
}
