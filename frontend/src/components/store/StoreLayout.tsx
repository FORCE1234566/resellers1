import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import StoreContactLinks from '@/components/store/StoreContactLinks';
import ResellerWhatsAppFloat from '@/components/store/ResellerWhatsAppFloat';
import { buildStoreBecomeResellerPath } from '@/lib/reseller-store-ref';

export type StoreTab = 'home' | 'services' | 'history' | 'faq' | 'contact';

interface StoreData {
  storeName: string;
  slug: string;
  phone: string;
  whatsapp: string;
  whatsappChannelUrl?: string;
  supportEmail: string;
  subResellerSignupOpen?: boolean;
}

const TABS: { id: StoreTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'history', label: 'Check History' },
  { id: 'faq', label: 'FAQs' },
  { id: 'contact', label: 'Contact' },
];

export default function StoreLayout({
  store,
  activeTab,
  onTabChange,
  children,
}: {
  store: StoreData;
  activeTab: StoreTab;
  onTabChange: (tab: StoreTab) => void;
  children: React.ReactNode;
}) {
  const displayName = store.storeName;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const selectTab = (tab: StoreTab) => {
    onTabChange(tab);
    setMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-navy">
      <header className="relative bg-navy-light/95 backdrop-blur-md border-b border-navy-border sticky top-0 z-40 h-16">
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">
          <span className="text-base sm:text-lg font-bold text-white truncate min-w-0">{displayName}</span>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="p-2 text-white hover:text-gold transition shrink-0"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 top-16 bg-black/40 z-30"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            />
            <nav className="absolute right-0 top-full w-full sm:w-72 z-40 bg-navy-light border-b border-l border-navy-border shadow-xl shadow-black/30">
              <ul className="py-2">
                {TABS.map((tab) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => selectTab(tab.id)}
                      className={cn(
                        'w-full text-left px-6 py-3.5 text-sm font-medium transition-colors',
                        activeTab === tab.id
                          ? 'text-gold bg-gold/10 border-r-2 border-gold'
                          : 'text-gray-300 hover:text-white hover:bg-white/5'
                      )}
                    >
                      {tab.label}
                    </button>
                  </li>
                ))}
                {store.subResellerSignupOpen !== false && (
                  <li>
                    <Link
                      to={buildStoreBecomeResellerPath(store.slug)}
                      onClick={() => setMenuOpen(false)}
                      className="block w-full text-left px-6 py-3.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      Become a Reseller
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          </>
        )}
      </header>

      <main>{children}</main>

      <footer className="bg-navy-light border-t border-navy-border py-8 mt-12 safe-bottom">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center sm:text-left">
          <h3 className="text-white font-bold mb-2">{displayName}</h3>
          <StoreContactLinks
            phone={store.phone}
            whatsapp={store.whatsapp}
            whatsappChannelUrl={store.whatsappChannelUrl}
            storeName={store.storeName}
            layout="footer"
          />
          <p className="text-xs text-gray-500 mt-6 text-center sm:text-left">
            &copy; {new Date().getFullYear()} {displayName}. All rights reserved.
          </p>
        </div>
      </footer>

      <ResellerWhatsAppFloat
        whatsapp={store.whatsapp}
        phone={store.phone}
        whatsappChannelUrl={store.whatsappChannelUrl}
        storeName={store.storeName}
      />
    </div>
  );
}
