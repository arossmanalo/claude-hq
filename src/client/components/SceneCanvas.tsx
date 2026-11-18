import { useEffect, useRef } from "react";
import { Application, TextureStyle } from "pixi.js";
import { PALETTE } from "../scene/pixels";
import { SIGN_FONT, type Scene } from "../scene/scene";
import styles from "./SceneCanvas.module.css";

TextureStyle.defaultOptions.scaleMode = "nearest";

interface SceneCanvasProps<T> {
  /** Must be stable (memoised); a new function remounts the scene. */
  createScene: () => Scene<T>;
  data: T;
  /** Describes the picture for screen readers; the panel beside it has the same content as text. */
  label: string;
}

/** Hosts one Pixi application and keeps it sized to its container's width. */
export function SceneCanvas<T>({ createScene, data, label }: SceneCanvasProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene<T> | null>(null);
  const resizeRef = useRef<() => void>(() => {});
  const dataRef = useRef(data);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    let ready = false;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    const setUp = async () => {
      await document.fonts.load(`16px "${SIGN_FONT}"`);
      await app.init({
        background: PALETTE.sky,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        width: host.clientWidth || 300,
        height: 200,
      });
      ready = true;
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      app.canvas.setAttribute("aria-hidden", "true");
      host.appendChild(app.canvas);
      const scene = createScene();
      sceneRef.current = scene;
      app.stage.addChild(scene.root);
      scene.update(dataRef.current);
      const resize = () => {
        const width = Math.max(240, host.clientWidth);
        const height = scene.layout(width);
        app.renderer.resize(width, height);
      };
      resizeRef.current = resize;
      observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      const started = performance.now();
      app.ticker.add(() => scene.tick(performance.now() - started));
    };

    setUp().catch((error: unknown) => {
      host.textContent = `The office drawing failed to start: ${
        error instanceof Error ? error.message : String(error)
      }. The panel still works.`;
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      sceneRef.current = null;
      resizeRef.current = () => {};
      if (ready) app.destroy(true, { children: true });
    };
  }, [createScene]);

  useEffect(() => {
    dataRef.current = data;
    const scene = sceneRef.current;
    if (!scene) return;
    scene.update(data);
    // Floors or rooms may have been added, which changes the height.
    resizeRef.current();
  }, [data]);

  return <div ref={hostRef} className={styles.host} role="img" aria-label={label} />;
}
