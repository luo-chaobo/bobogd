import React from "react";
import { Composition } from "remotion";
import { FactoryService } from "./FactoryService";

export const VideoRoot: React.FC = () => (
  <Composition
    id="FactoryService"
    component={FactoryService}
    durationInFrames={750}
    fps={30}
    width={1920}
    height={1080}
  />
);
