import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function AdminSearchBar({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState(params.get('q') || '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q.length < 2) return;
    navigate(`/admin/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col sm:flex-row gap-2 ${className}`}
    >
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search resellers, phone numbers, order IDs…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy/80 border border-navy-border text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
          aria-label="Search resellers, phone numbers, and order IDs"
        />
      </div>
      <Button type="submit" size="sm" className="shrink-0 px-5">
        <Search className="w-4 h-4" />
        Search
      </Button>
    </form>
  );
}
