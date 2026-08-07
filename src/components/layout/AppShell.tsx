import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { FeedbackWidget } from '../feedback/FeedbackWidget';

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-ink-50)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main ref={mainRef} className="flex-1 overflow-y-auto scrollbar-thin [overflow-anchor:none]">
          {/* No AnimatePresence/mode="wait" here: combined with StrictMode it caused a delayed phantom
              remount ~180ms after navigation, silently resetting page-local state (e.g. an active tab)
              right as a user's first click landed. Plain enter-only animation avoids it. */}
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
      <FeedbackWidget />
    </div>
  );
}
