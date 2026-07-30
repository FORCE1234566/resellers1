import { Link } from 'react-router';
import Button from '@/components/ui/Button';
import { Store, Users, Shield } from 'lucide-react';
import BrandLogo from '@/components/ui/BrandLogo';
import BackHomeLink from '@/components/ui/BackHomeLink';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-gold/5 rounded-full blur-3xl" />

      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-8">
          <div className="mb-6">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Choose Portal</h1>
          <p className="text-gray-400 mt-2">Select how you want to sign in</p>
        </div>

        <div className="space-y-4">
          <Link to="/login/reseller" className="block bg-navy-card border border-navy-border rounded-xl p-5 hover:border-gold/40 transition group">
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-3 bg-gold/10 text-gold rounded-lg group-hover:bg-gold/20 transition shrink-0"><Store className="w-6 h-6" /></div>
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Reseller Login</h2>
                <p className="text-sm text-gray-400">Sign in or create a new reseller account</p>
              </div>
            </div>
          </Link>

          <Link to="/login/agent" className="block bg-navy-card border border-navy-border rounded-xl p-5 hover:border-gold/40 transition group">
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-3 bg-gold/10 text-gold rounded-lg group-hover:bg-gold/20 transition shrink-0"><Users className="w-6 h-6" /></div>
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Agent Login</h2>
                <p className="text-sm text-gray-400">Admin-created accounts only</p>
              </div>
            </div>
          </Link>

          <Link to="/login/admin" className="block bg-navy-card border border-navy-border rounded-xl p-5 hover:border-gold/40 transition group">
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-3 bg-gold/10 text-gold rounded-lg group-hover:bg-gold/20 transition shrink-0"><Shield className="w-6 h-6" /></div>
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Admin Login</h2>
                <p className="text-sm text-gray-400">Platform administration</p>
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-6 text-center">
          <Link to="/register">
            <Button variant="primary" className="w-full">Become A Reseller — Sign Up</Button>
          </Link>
        </div>

        <div className="mt-6 text-center">
          <BackHomeLink />
        </div>
      </div>
    </div>
  );
}
