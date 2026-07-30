import { Navigate } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import type { User } from '@/lib/auth-context';

const loginPaths: Record<User['role'], string> = {
  admin: '/login/admin',
  agent: '/login/agent',
  reseller: '/login/reseller',
};

export default function ProtectedRoute({
  role,
  children,
}: {
  role: User['role'];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || user.role !== role) {
    return <Navigate to={loginPaths[role]} replace />;
  }

  if (user.status === 'suspended') {
    return <Navigate to={loginPaths[role]} replace />;
  }

  return <>{children}</>;
}
