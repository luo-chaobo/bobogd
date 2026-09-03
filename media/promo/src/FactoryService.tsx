import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";

type SceneProps = {
  image: string;
  eyebrow: string;
  title: string;
  detail: string;
  align?: "left" | "right";
  accent?: string;
};

const SCENE_FRAMES = 125;
const orange = "#ff6a2a";

const Scene: React.FC<SceneProps> = ({ image, eyebrow, title, detail, align = "left", accent = orange }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 16, 103, 124], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, 124], [1.03, 1.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const textX = interpolate(frame, [8, 30], [align === "left" ? -70 : 70, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const justifyContent = align === "left" ? "flex-start" : "flex-end";
  const textAlign = align === "left" ? "left" : "right";
  return (
    <AbsoluteFill style={{ backgroundColor: "#0c1820", opacity, overflow: "hidden", fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif' }}>
      <Img src={staticFile(`assets/images/${image}`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
      <AbsoluteFill style={{ background: align === "left" ? "linear-gradient(90deg, rgba(5,18,27,.94) 0%, rgba(5,18,27,.72) 48%, rgba(5,18,27,.12) 78%)" : "linear-gradient(270deg, rgba(5,18,27,.94) 0%, rgba(5,18,27,.72) 48%, rgba(5,18,27,.12) 78%)" }} />
      <AbsoluteFill style={{ padding: "100px 132px 210px", justifyContent, alignItems: align === "left" ? "flex-start" : "flex-end", textAlign }}>
        <div style={{ width: 760, transform: `translateX(${textX}px)` }}>
          <div style={{ color: accent, fontSize: 25, fontWeight: 700, letterSpacing: 8, marginBottom: 26 }}>{eyebrow}</div>
          <div style={{ color: "white", fontSize: 72, fontWeight: 800, lineHeight: 1.18, letterSpacing: 1, whiteSpace: "pre-line" }}>{title}</div>
          <div style={{ width: 92, height: 8, backgroundColor: accent, margin: align === "left" ? "32px 0" : "32px 0 32px auto" }} />
          <div style={{ color: "#dbe5ea", fontSize: 32, lineHeight: 1.65 }}>{detail}</div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 104, right: 104, bottom: 48, display: "flex", justifyContent: "space-between", color: "white", backgroundColor: "rgba(5,18,27,.78)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: "18px 28px", fontSize: 24, letterSpacing: 3, textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>
        <span>宁波未来机械 · 非标钣金制造</span><span>WLJIXIE.COM</span>
      </div>
    </AbsoluteFill>
  );
};

const scenes: SceneProps[] = [
  { image: "factory-workshop.jpg", eyebrow: "NINGBO · CUSTOM SHEET METAL", title: "让需求，\n更快进入制造", detail: "非标钣金加工服务 · 有图、无图都可沟通" },
  { image: "laser-cutting.jpg", eyebrow: "01 · 激光切割", title: "从图纸开始，\n也从需求开始", detail: "照片、草图和关键尺寸，也可以成为沟通起点", align: "right" },
  { image: "cnc-bending.jpg", eyebrow: "02 · 折弯成形", title: "小批量，\n也值得认真推进", detail: "先确认材料、数量、尺寸与期望交期，再进行报价" },
  { image: "welding.jpg", eyebrow: "03 · 焊接制作", title: "每一步，\n围绕交付推进", detail: "客服及时接收信息，短时间了解加工需求", align: "right" },
  { image: "surface-finishing.jpg", eyebrow: "04 · 表面处理与成品", title: "从加工到质检，\n再到交付", detail: "客户可通过订单号和手机号查询公开进度" },
  { image: "new-energy-cabinet.jpg", eyebrow: "提交加工需求", title: "急件 · 小批量\n无图可沟通", detail: "08:00–17:00 工作时段 · 工作时段 10 分钟响应 · 全额到账后开工", align: "right" }
];

export const FactoryService: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0c1820" }}>
    {scenes.map((scene, index) => (
      <Sequence key={scene.image} from={index * SCENE_FRAMES} durationInFrames={SCENE_FRAMES} premountFor={15}>
        <Scene {...scene} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
