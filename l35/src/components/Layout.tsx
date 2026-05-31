import { NavLink, Outlet } from "react-router-dom";
import { Shield, Monitor, Video, MapPin } from "lucide-react";

const navItems = [
  { to: "/", label: "监控大屏", icon: Monitor },
  { to: "/sources", label: "视频源", icon: Video },
  { to: "/defense", label: "区域布防", icon: MapPin },
];

export default function Layout() {
  return (
    <div className="flex h-screen flex-col bg-[#0A0E17] text-[#E2E8F0]">
      <header className="flex h-14 items-center border-b border-[#2A3040] bg-[#1A1F2E] px-4">
        <div className="flex items-center gap-2 mr-8">
          <Shield className="h-6 w-6 text-[#00E5A0]" />
          <span className="font-bold text-lg tracking-wide text-[#00E5A0]">
            EdgeGuard AI
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-[#2A3040] text-[#00E5A0]"
                    : "text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#2A3040]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                  {isActive && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#00E5A0] shadow-[0_0_6px_#00E5A0]" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#00E5A0] shadow-[0_0_6px_#00E5A0]" />
          <span className="text-xs text-[#64748B]">系统在线</span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
