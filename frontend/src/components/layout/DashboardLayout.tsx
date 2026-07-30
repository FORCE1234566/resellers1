import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Package, ShoppingCart, MessageSquare,
  Wallet, Settings, LogOut, Code, Menu, X, Store,
  DollarSign, Bell, Phone, Search, Tag,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import AdminSearchBar from '@/components/admin/AdminSearchBar';
import { BrandMark } from '@/components/ui/BrandLogo';
import ContactHelpButton from '@/components/ui/ContactHelpButton';
import { ADMIN_SUPPORT_DISPLAY, ADMIN_SUPPORT_PHONE } from '@/lib/support-contact';

const adminLinks = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/search', label: 'Search', icon: Search },
  { href: '/admin/agents', label: 'Agents', icon: Users },
  { href: '/admin/resellers', label: 'Resellers', icon: Store },
  { href: '/admin/packages', label: 'Packages', icon: Package },
  { href: '/admin/promo-codes', label: 'Promo Codes', icon: Tag },
  { href: '/admin/checkers', label: 'Results Checkers', icon: Package },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: Wallet },
  { href: '/admin/complaints', label: 'Complaints', icon: MessageSquare },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

const agentLinks = [
  { href: '/agent', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agent/purchase', label: 'Buy Data', icon: ShoppingCart },
  { href: '/agent/afa', label: 'AFA Registration', icon: Package },
  { href: '/agent/checker', label: 'Results Checker', icon: Package },
  { href: '/agent/bulk', label: 'Bulk Purchase', icon: Package },
  { href: '/agent/wallet', label: 'Wallet', icon: Wallet },
  { href: '/agent/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/agent/complaints', label: 'Complaints', icon: MessageSquare },
  { href: '/agent/api', label: 'Developer API', icon: Code },
];

const resellerLinks = [
  { href: '/reseller', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reseller/store', label: 'My Store', icon: Store },
  { href: '/reseller/prices', label: 'Prices', icon: DollarSign },
  { href: '/reseller/sub-resellers', label: 'My Resellers', icon: Users },
  { href: '/reseller/sub-resellers/default-prices', label: 'Sub-Reseller Prices', icon: DollarSign },
  { href: '/reseller/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/reseller/withdrawals', label: 'Withdrawals', icon: Wallet },
  { href: '/reseller/complaints', label: 'Complaints', icon: MessageSquare },
];

export default function DashboardLayout({
  children,
  role,
}: {
  children: React.ReactNode;
  role: 'admin' | 'agent' | 'reseller';
}) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const links = role === 'admin' ? adminLinks : role === 'agent' ? agentLinks : resellerLinks;
  const portalName = role === 'admin' ? 'Admin Portal' : role === 'agent' ? 'Agent Portal' : 'Reseller Portal';
  const displayName = user?.firstName || user?.fullName?.split(/\s+/)[0] || 'User';
  const rankLabel = user?.performance?.rankLabel;

  useEffect(() => {
    if (!sidebarOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await logout();
    const loginRoutes: Record<string, string> = {
      admin: '/login/admin',
      agent: '/login/agent',
      reseller: '/login/reseller',
    };
    navigate(loginRoutes[role] || '/login');
  };

  return (
    <div className="min-h-screen bg-navy">
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between h-16 px-4 bg-navy-light border-b border-navy-border">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 text-white"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="min-w-0 px-2 text-center">
          <span className="block font-semibold text-white text-sm truncate">{displayName}</span>
          {rankLabel && (
            <span className="block text-[10px] text-gold font-medium truncate">{rankLabel} this month</span>
          )}
        </div>
        <Bell className="w-5 h-5 text-gray-400 shrink-0" />
      </div>

      <div className="flex min-h-[calc(100dvh-4rem)] lg:min-h-screen">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-72 max-w-[min(18rem,85vw)] bg-navy-light border-r border-navy-border',
            'flex flex-col transform transition-transform duration-200 lg:translate-x-0 lg:static lg:max-w-none lg:w-64 lg:shrink-0 lg:min-h-screen lg:sticky lg:top-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-navy-border shrink-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{displayName}</p>
              {rankLabel ? (
                <p className="text-xs text-gold font-medium truncate">{rankLabel} this month</p>
              ) : (
                <p className="text-xs text-gray-400 truncate">{portalName}</p>
              )}
              <h1 className="text-base font-bold text-white truncate mt-1">
                <BrandMark />
              </h1>
            </div>
            <button
              type="button"
              className="lg:hidden text-gray-400 p-1 shrink-0"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition',
                    active
                      ? 'bg-gold/15 text-gold border border-gold/20'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="shrink-0 p-3 sm:p-4 border-t border-navy-border safe-bottom">
            <ContactHelpButton
              phone={ADMIN_SUPPORT_PHONE}
              displayPhone={ADMIN_SUPPORT_DISPLAY}
              smsBody="Hi topdealsgh, I need support."
              whatsAppText="Hi topdealsgh, I need support."
              className="flex items-center gap-2.5 px-3 py-2.5 mb-2 rounded-lg bg-navy/60 border border-navy-border hover:border-gold/30 transition w-full text-left"
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gold/15 text-gold shrink-0">
                <Phone className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500">Support</span>
                <span className="block text-xs font-semibold text-white truncate">{ADMIN_SUPPORT_DISPLAY}</span>
              </span>
            </ContactHelpButton>
            <div className="px-3 py-2 mb-2 min-w-0">
              <p className="text-sm font-medium text-white truncate">{displayName}</p>
              {rankLabel && (
                <p className="text-xs text-gold font-medium truncate">{rankLabel} performer</p>
              )}
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              Logout
            </button>
          </div>
        </aside>

        {sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 min-w-0 w-full p-4 sm:p-6 lg:p-8 pb-6 safe-x safe-bottom text-white overflow-x-hidden">
          {role === 'admin' && !pathname.startsWith('/admin/search') && (
            <AdminSearchBar className="mb-6 max-w-2xl" />
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
