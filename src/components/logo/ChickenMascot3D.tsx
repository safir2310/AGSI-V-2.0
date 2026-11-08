"use client";

import { useCallback } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { cn } from "@/lib/utils";

type ChickenMascot3DProps = {
  /** Lebar tampilan (px). Rasio scene 220:230 di-scale otomatis. */
  size?: number;
  className?: string;
  /** Animasi masuk (pop spring) saat pertama tampil */
  entrance?: boolean;
  /** Parallax 3D mengikuti kursor (mati otomatis bila prefers-reduced-motion) */
  interactive?: boolean;
};

/**
 * MASKOT AYAM KOKI 3D — AYAM GEPREK SAMBAL IJO.
 *
 * Dibangun murni dengan CSS 3D transforms + framer-motion (tanpa dependensi
 * tambahan): tiap bagian tubuh adalah lapisan dengan `translateZ` berbeda di
 * dalam scene ber-`perspective`, sehingga saat panggung berputar (idle wobble
 * + parallax kursor) lapisan bergeser satu sama lain — kesan volum 3D sungguhan.
 *
 * Animasi idle:
 *  - mengambang naik-turun (bayangan lantai ikut mengecil/membesar)
 *  - kepala menengok kiri-kanan + badan berayun rotateY (parallax antar lapisan)
 *  - berkedip tiap ±4 detik
 *  - sayap mengepak singkat berkala
 *  - gelembung kilau mengapung di depan (translateZ besar)
 * Interaktif: miring mengikuti posisi kursor (spring halus), kembali netral saat kursor pergi.
 *
 * Palet & karakter sama dengan ChickenLogo (topi koki putih, syal sambal ijo).
 */
export function ChickenMascot3D({
  size = 132,
  className,
  entrance = false,
  interactive = true,
}: ChickenMascot3DProps) {
  const prefersReduced = useReducedMotion();
  const idle = !prefersReduced;

  // ===== Parallax kursor (spring agar gerakan halus & mengendap lembut) =====
  const rawY = useMotionValue(0); // rotateY target (deg)
  const rawX = useMotionValue(0); // rotateX target (deg)
  const rotateY = useSpring(rawY, { stiffness: 110, damping: 15, mass: 0.6 });
  const rotateX = useSpring(rawX, { stiffness: 110, damping: 15, mass: 0.6 });

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive || prefersReduced) return;
      const r = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5; // 0..1 → -0.5..0.5
      const ny = (e.clientY - r.top) / r.height - 0.5;
      rawY.set(nx * 26);
      rawX.set(-ny * 16);
    },
    [interactive, prefersReduced, rawX, rawY]
  );

  const handleLeave = useCallback(() => {
    rawY.set(0);
    rawX.set(0);
  }, [rawX, rawY]);

  const scale = size / 220;

  return (
    <motion.div
      role="img"
      aria-label="Maskot ayam koki 3D Ayam Geprek Sambal Ijo"
      className={cn("select-none", className)}
      style={{ width: size, height: Math.round(size * (230 / 220)) }}
      initial={entrance ? { scale: 0.4, opacity: 0, y: 26 } : false}
      animate={entrance ? { scale: 1, opacity: 1, y: 0 } : undefined}
      transition={{ type: "spring", stiffness: 240, damping: 16, mass: 0.9 }}
    >
      {/* Scene: skala internal 220×230 → ukuran permintaan */}
      <div
        className="relative"
        style={{
          width: 220,
          height: 230,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          perspective: 820,
        }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {/* ===== RIG PARALLAX (miring mengikuti kursor) ===== */}
        <motion.div
          className="absolute inset-0"
          style={{
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
          }}
        >
          {/* ===== RIG IDLE (mengambang + ayun rotateY) ===== */}
          <motion.div
            className="absolute inset-0"
            style={{ transformStyle: "preserve-3d" }}
            animate={idle ? { y: [0, -9, 0], rotateY: [0, 9, 0, -9, 0] } : undefined}
            transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* ============ LAPISAN BELAKANG (translateZ -26) ============ */}
            <div
              className="absolute inset-0"
              style={{ transformStyle: "preserve-3d", transform: "translateZ(-26px)" }}
            >
              {/* Sayap kiri */}
              <div
                className="absolute"
                style={{ left: 22, top: 128, transformOrigin: "50% 12%", transform: "rotate(14deg)" }}
              >
                <motion.div
                  animate={idle ? { rotate: [0, 0, -30, 0, 0] } : undefined}
                  transition={{ duration: 4.6, repeat: Infinity, times: [0, 0.6, 0.68, 0.78, 1], ease: "easeInOut" }}
                  style={{ transformOrigin: "50% 12%" }}
                >
                  <div
                    className="h-[74px] w-[42px]"
                    style={{
                      borderRadius: "50%",
                      background: "linear-gradient(150deg, #FB923C 8%, #F97316 45%, #C2410C 100%)",
                      boxShadow: "inset -6px -8px 12px rgba(146,64,14,0.5), inset 5px 6px 10px rgba(255,237,213,0.4)",
                    }}
                  />
                </motion.div>
              </div>
              {/* Sayap kanan */}
              <div
                className="absolute"
                style={{ left: 156, top: 128, transformOrigin: "50% 12%", transform: "rotate(-14deg)" }}
              >
                <motion.div
                  animate={idle ? { rotate: [0, 0, 30, 0, 0] } : undefined}
                  transition={{ duration: 4.6, repeat: Infinity, times: [0, 0.6, 0.68, 0.78, 1], ease: "easeInOut" }}
                  style={{ transformOrigin: "50% 12%" }}
                >
                  <div
                    className="h-[74px] w-[42px]"
                    style={{
                      borderRadius: "50%",
                      background: "linear-gradient(210deg, #FB923C 8%, #F97316 45%, #C2410C 100%)",
                      boxShadow: "inset 6px -8px 12px rgba(146,64,14,0.5), inset -5px 6px 10px rgba(255,237,213,0.4)",
                    }}
                  />
                </motion.div>
              </div>
              {/* Ekor kecil di belakang bawah */}
              <div
                className="absolute h-[34px] w-[30px]"
                style={{
                  left: 96,
                  top: 196,
                  borderRadius: "46% 54% 52% 48% / 60% 58% 42% 40%",
                  background: "radial-gradient(circle at 40% 30%, #FB923C, #C2410C 85%)",
                  boxShadow: "inset -4px -4px 8px rgba(146,64,14,0.55)",
                }}
              />
            </div>

            {/* ============ BADAN (translateZ 0) ============ */}
            <div
              className="absolute h-[118px] w-[152px]"
              style={{
                left: 34,
                top: 104,
                borderRadius: "52% 48% 50% 50% / 58% 58% 44% 44%",
                background:
                  "radial-gradient(circle at 34% 24%, #FFE0B0 0%, #FDBA74 28%, #F97316 64%, #E0570A 100%)",
                boxShadow:
                  "inset -20px -16px 30px rgba(154,52,18,0.38), inset 16px 12px 26px rgba(255,255,255,0.30), 0 14px 22px rgba(154,52,18,0.22)",
              }}
            >
              {/* Perut krem */}
              <div
                className="absolute h-[74px] w-[92px]"
                style={{
                  left: 30,
                  top: 38,
                  borderRadius: "50%",
                  background: "linear-gradient(180deg, #FFFBF5 12%, #FFEDD5 88%)",
                  boxShadow: "inset -8px -8px 16px rgba(253,186,116,0.55)",
                }}
              />
              {/* Kilau glossy */}
              <div
                className="absolute h-[16px] w-[30px]"
                style={{
                  left: 22,
                  top: 12,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.5)",
                  filter: "blur(4px)",
                  transform: "rotate(-26deg)",
                }}
              />
            </div>

            {/* ============ KAKI (translateZ +6) ============ */}
            <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: "translateZ(6px)" }}>
              {[78, 120].map((left) => (
                <div
                  key={left}
                  className="absolute h-[11px] w-[27px]"
                  style={{
                    left,
                    top: 212,
                    borderRadius: 8,
                    background: "linear-gradient(180deg, #FBBF24, #D97706)",
                    boxShadow: "0 2px 4px rgba(154,52,18,0.35), inset 0 2px 2px rgba(255,255,255,0.45)",
                  }}
                />
              ))}
            </div>

            {/* ============ SYAL SAMBAL IJO (translateZ +14) ============ */}
            <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: "translateZ(14px)" }}>
              {/* Ujung syal berkibar */}
              <motion.div
                className="absolute"
                style={{ left: 138, top: 150, transformOrigin: "20% 20%" }}
                animate={idle ? { rotate: [0, -7, 0, 5, 0] } : undefined}
                transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              >
                <div
                  className="h-[20px] w-[26px]"
                  style={{
                    background: "linear-gradient(160deg, #22C55E, #15803D)",
                    clipPath: "polygon(0 0, 100% 12%, 62% 100%, 30% 78%)",
                  }}
                />
              </motion.div>
              {/* Band syal */}
              <div
                className="absolute h-[26px] w-[116px]"
                style={{
                  left: 52,
                  top: 138,
                  borderRadius: 14,
                  background: "linear-gradient(180deg, #4ADE80 0%, #22C55E 55%, #16A34A 100%)",
                  boxShadow: "inset 0 3px 5px rgba(255,255,255,0.4), inset 0 -5px 8px rgba(21,128,61,0.55), 0 4px 8px rgba(21,128,61,0.30)",
                }}
              />
              {/* Simpul syal */}
              <div
                className="absolute h-[20px] w-[24px]"
                style={{
                  left: 98,
                  top: 150,
                  borderRadius: "40% 40% 48% 48%",
                  background: "linear-gradient(180deg, #4ADE80, #16A34A)",
                  boxShadow: "inset -3px -4px 6px rgba(21,128,61,0.6), 0 3px 5px rgba(21,128,61,0.35)",
                }}
              />
            </div>

            {/* ============ KEPALA (translateZ +30, menengok kiri-kanan) ============ */}
            <div
              className="absolute h-[100px] w-[100px]"
              style={{
                left: 60,
                top: 26,
                transformStyle: "preserve-3d",
                transform: "translateZ(30px)",
              }}
            >
              <motion.div
                className="relative h-full w-full"
                animate={idle ? { rotate: [0, 4.5, 0, -4.5, 0] } : undefined}
                transition={{ duration: 5.6, repeat: Infinity, ease: "easeInOut" }}
                style={{ transformOrigin: "50% 86%", transformStyle: "preserve-3d" }}
              >
                {/* Bola kepala */}
                <div
                  className="absolute inset-0"
                  style={{
                    borderRadius: "50%",
                    background:
                      "radial-gradient(circle at 35% 26%, #FFE6BD 0%, #FDBA74 30%, #F97316 68%, #EA580C 100%)",
                    boxShadow:
                      "inset -14px -12px 24px rgba(154,52,18,0.38), inset 12px 10px 20px rgba(255,255,255,0.32), 0 10px 18px rgba(154,52,18,0.25)",
                  }}
                />
                {/* Kilau glossy kepala */}
                <div
                  className="absolute h-[14px] w-[26px]"
                  style={{
                    left: 16,
                    top: 12,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.5)",
                    filter: "blur(3px)",
                    transform: "rotate(-24deg)",
                  }}
                />

                {/* ===== TOPI KOKI (sedikit miring, playful) ===== */}
                <div
                  className="absolute"
                  style={{ left: 0, top: -30, width: 100, transform: "rotate(-6deg)" }}
                >
                  {/* puffy toque */}
                  <div
                    className="absolute h-[30px] w-[26px]"
                    style={{
                      left: 12,
                      top: 10,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 35% 28%, #FFFFFF, #E7EDF3 82%)",
                      boxShadow: "inset -4px -4px 8px rgba(148,163,184,0.5), 0 3px 6px rgba(154,52,18,0.18)",
                    }}
                  />
                  <div
                    className="absolute h-[36px] w-[34px]"
                    style={{
                      left: 34,
                      top: 0,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 35% 28%, #FFFFFF, #E7EDF3 82%)",
                      boxShadow: "inset -5px -5px 9px rgba(148,163,184,0.5), 0 3px 6px rgba(154,52,18,0.18)",
                    }}
                  />
                  <div
                    className="absolute h-[28px] w-[24px]"
                    style={{
                      left: 64,
                      top: 12,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 35% 28%, #FFFFFF, #E7EDF3 82%)",
                      boxShadow: "inset -4px -4px 8px rgba(148,163,184,0.5), 0 3px 6px rgba(154,52,18,0.18)",
                    }}
                  />
                  {/* band topi */}
                  <div
                    className="absolute h-[17px] w-[72px]"
                    style={{
                      left: 14,
                      top: 32,
                      borderRadius: 9,
                      background: "linear-gradient(180deg, #FFFFFF 30%, #EDF1F5 70%, #DDE5EC 100%)",
                      boxShadow: "inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -3px 5px rgba(148,163,184,0.55), 0 3px 6px rgba(154,52,18,0.2)",
                    }}
                  />
                  {/* bayangan topi di kepala */}
                  <div
                    className="absolute h-[10px] w-[56px]"
                    style={{
                      left: 22,
                      top: 48,
                      borderRadius: "50%",
                      background: "rgba(194,65,12,0.30)",
                      filter: "blur(3px)",
                    }}
                  />
                </div>

                {/* ===== MATA (berkedip) ===== */}
                {[
                  { cx: 24, cy: 52 },
                  { cx: 62, cy: 52 },
                ].map((p) => (
                  <motion.div
                    key={p.cx}
                    className="absolute"
                    style={{ left: p.cx, top: p.cy, width: 16, height: 17 }}
                    animate={idle ? { scaleY: [1, 1, 0.06, 1, 1] } : undefined}
                    transition={{
                      duration: 4.4,
                      repeat: Infinity,
                      times: [0, 0.9, 0.94, 0.98, 1],
                      ease: "linear",
                    }}
                  >
                    <div
                      className="h-full w-full"
                      style={{
                        borderRadius: "50%",
                        background: "radial-gradient(circle at 38% 30%, #5B2A0F, #451A03 70%)",
                      }}
                    />
                    <div
                      className="absolute h-[5px] w-[5px] rounded-full bg-white"
                      style={{ left: 3, top: 3 }}
                    />
                    <div
                      className="absolute h-[2px] w-[2px] rounded-full bg-white/70"
                      style={{ left: 10, top: 11 }}
                    />
                  </motion.div>
                ))}

                {/* ===== PIPI ===== */}
                <div
                  className="absolute h-[11px] w-[15px]"
                  style={{
                    left: 6,
                    top: 66,
                    borderRadius: "50%",
                    background: "rgba(244,63,94,0.32)",
                    filter: "blur(1px)",
                  }}
                />
                <div
                  className="absolute h-[11px] w-[15px]"
                  style={{
                    left: 79,
                    top: 66,
                    borderRadius: "50%",
                    background: "rgba(244,63,94,0.32)",
                    filter: "blur(1px)",
                  }}
                />

                {/* ===== PARUH ===== */}
                <div className="absolute" style={{ left: 33, top: 62, width: 34 }}>
                  <div
                    className="h-[15px] w-[34px]"
                    style={{
                      background: "linear-gradient(180deg, #FCD34D 20%, #F59E0B 90%)",
                      clipPath: "polygon(6% 0, 94% 0, 52% 100%)",
                      filter: "drop-shadow(0 2px 2px rgba(154,52,18,0.28))",
                    }}
                  />
                  <div
                    className="mx-auto h-[7px] w-[16px]"
                    style={{
                      background: "linear-gradient(180deg, #D97706, #B45309)",
                      clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                    }}
                  />
                </div>

                {/* ===== PIAL (WATTLE) ===== */}
                <div
                  className="absolute h-[15px] w-[11px]"
                  style={{
                    left: 45,
                    top: 82,
                    borderRadius: "40% 40% 52% 52%",
                    background: "linear-gradient(180deg, #FB7185, #E11D48)",
                    boxShadow: "inset -2px -2px 4px rgba(190,18,60,0.6)",
                  }}
                />
              </motion.div>
            </div>

            {/* ============ GELEMBUNG KILAU DEPAN (translateZ +60) ============ */}
            <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: "translateZ(60px)" }}>
              <motion.div
                className="absolute h-[14px] w-[14px] rounded-full"
                style={{
                  left: 24,
                  top: 52,
                  background: "radial-gradient(circle at 32% 28%, #FFFFFF, rgba(255,255,255,0.18) 70%)",
                }}
                animate={idle ? { y: [0, -12, 0], opacity: [0.55, 0.9, 0.55] } : undefined}
                transition={{ duration: 3.1, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute h-[9px] w-[9px] rounded-full"
                style={{
                  left: 186,
                  top: 84,
                  background: "radial-gradient(circle at 32% 28%, #FFFFFF, rgba(255,237,213,0.25) 72%)",
                }}
                animate={idle ? { y: [0, 10, 0], opacity: [0.45, 0.85, 0.45] } : undefined}
                transition={{ duration: 3.7, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
              />
              {/* Cabai hijau kecil melayang (sambal ijo) */}
              <motion.div
                className="absolute"
                style={{ left: 182, top: 26 }}
                animate={idle ? { y: [0, -8, 0], rotate: [0, -10, 0, 8, 0] } : undefined}
                transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <div
                  className="h-[26px] w-[10px]"
                  style={{
                    borderRadius: "46% 54% 52% 48% / 38% 42% 58% 62%",
                    background: "linear-gradient(160deg, #4ADE80 12%, #16A34A 82%)",
                    boxShadow: "inset -2px -3px 4px rgba(21,128,61,0.6)",
                    transform: "rotate(24deg)",
                  }}
                />
                <div
                  className="absolute h-[3px] w-[8px]"
                  style={{
                    left: 8,
                    top: -2,
                    borderRadius: 3,
                    background: "#166534",
                    transform: "rotate(-30deg)",
                  }}
                />
              </motion.div>
            </div>
          </motion.div>
        </motion.div>

        {/* ===== BAYANGAN LANTAI (berlawanan fase dengan gerakan mengambang) ===== */}
        <motion.div
          className="absolute rounded-[50%]"
          style={{
            left: 52,
            top: 216,
            width: 118,
            height: 18,
            background: "radial-gradient(ellipse, rgba(154,52,18,0.32), rgba(154,52,18,0.02) 72%)",
            filter: "blur(3px)",
            transformOrigin: "center",
          }}
          animate={idle ? { scaleX: [1, 0.86, 1], opacity: [1, 0.6, 1] } : undefined}
          transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </motion.div>
  );
}
