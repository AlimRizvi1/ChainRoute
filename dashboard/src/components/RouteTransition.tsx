import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Outlet, useLocation } from "react-router";

export function RouteTransition() {
  const container = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        container.current,
        { autoAlpha: 0.88, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.24, ease: "power4.out", clearProps: "all" },
      );
    });
    return () => media.revert();
  }, { scope: container, dependencies: [pathname], revertOnUpdate: true });

  return <div className="route-motion" ref={container}><Outlet /></div>;
}
