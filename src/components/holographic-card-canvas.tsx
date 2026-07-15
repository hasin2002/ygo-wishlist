"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type HoloProfile = {
  art: number;
  border: number;
  diagonal: number;
  dot: number;
  etched: number;
  full: number;
  gold: number;
  intensity: number;
  line: number;
  mosaic: number;
  name: number;
  platinum: number;
  shard: number;
  sparkle: number;
  spectral: number;
  speed: number;
  star: number;
};

type Tilt = {
  x: number;
  y: number;
};

const defaultProfile: HoloProfile = {
  art: 0.25,
  border: 0.2,
  diagonal: 0,
  dot: 0,
  etched: 0,
  full: 0.35,
  gold: 0,
  intensity: 0.55,
  line: 0.25,
  mosaic: 0,
  name: 0.15,
  platinum: 0,
  shard: 0,
  sparkle: 0.15,
  spectral: 0,
  speed: 0.35,
  star: 0,
};

const vertexShaderSource = `
  attribute vec2 aPosition;
  attribute vec2 aUv;

  varying vec2 vUv;

  void main() {
    vUv = aUv;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D uImage;
  uniform vec2 uTilt;
  uniform float uArt;
  uniform float uBorder;
  uniform float uDiagonal;
  uniform float uDot;
  uniform float uEtched;
  uniform float uFull;
  uniform float uGold;
  uniform float uIntensity;
  uniform float uLine;
  uniform float uMosaic;
  uniform float uName;
  uniform float uPlatinum;
  uniform float uReducedMotion;
  uniform float uShard;
  uniform float uSparkle;
  uniform float uSpectral;
  uniform float uSpeed;
  uniform float uStar;
  uniform float uTime;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float rectMask(vec2 uv, vec2 minUv, vec2 maxUv) {
    vec2 low = step(minUv, uv);
    vec2 high = step(uv, maxUv);
    return low.x * low.y * high.x * high.y;
  }

  vec3 rainbow(float t) {
    return 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.34, 0.67) + t));
  }

  void main() {
    vec2 uv = vUv;
    vec4 base = texture2D(uImage, uv);
    vec3 color = base.rgb;
    float tiltAmount = clamp(length(uTilt), 0.0, 1.0);
    float tiltResponse = smoothstep(0.06, 0.72, tiltAmount);
    float foilVisibility = mix(0.14, 1.0, tiltResponse);
    float time = uReducedMotion > 0.5
      ? 0.18
      : uTime * max(uSpeed, 0.01) * mix(0.12, 1.0, tiltResponse);

    float nameMask = rectMask(uv, vec2(0.10, 0.775), vec2(0.90, 0.925));
    float artMask = rectMask(uv, vec2(0.145, 0.355), vec2(0.855, 0.720));
    float edgeX = max(1.0 - step(0.055, uv.x), step(0.945, uv.x));
    float edgeY = max(1.0 - step(0.050, uv.y), step(0.950, uv.y));
    float borderMask = max(edgeX, edgeY);
    float targetMask = clamp(
      uFull + uName * nameMask + uArt * artMask + uBorder * borderMask,
      0.0,
      1.0
    );

    float tiltSweep = dot(uv - 0.5, vec2(uTilt.x, -uTilt.y)) * 1.7;
    float broadSweep = pow(
      0.5 + 0.5 * sin((uv.x * 1.4 + uv.y * 1.8 + tiltSweep + time * 0.65) * 6.2831853),
      5.0
    );
    float fineSweep = pow(
      0.5 + 0.5 * sin((uv.x * 5.0 - uv.y * 3.0 + tiltSweep + time * 1.1) * 6.2831853),
      14.0
    );
    float diagonal = pow(
      0.5 + 0.5 * sin((uv.x * 16.0 + uv.y * 28.0 + time * 3.0 + tiltSweep) * 3.1415926),
      18.0
    );
    float lines = pow(
      0.5 + 0.5 * sin((uv.x * 92.0 + uv.y * 42.0 + time * 8.0) * 3.1415926),
      20.0
    );

    vec2 dotGrid = uv * vec2(44.0, 64.0);
    vec2 dotCell = fract(dotGrid) - 0.5;
    float dotSeed = step(0.55, hash(floor(dotGrid)));
    float dots = smoothstep(0.16, 0.015, length(dotCell)) * dotSeed;

    vec2 mosaicGrid = floor(uv * vec2(18.0, 26.0));
    float mosaic = smoothstep(0.45, 1.0, hash(mosaicGrid));

    vec2 starGrid = uv * vec2(26.0, 38.0);
    vec2 starCell = abs(fract(starGrid) - 0.5);
    float starSeed = step(0.78, hash(floor(starGrid)));
    float starShape =
      max(
        smoothstep(0.035, 0.0, starCell.x) * smoothstep(0.22, 0.0, starCell.y),
        smoothstep(0.035, 0.0, starCell.y) * smoothstep(0.22, 0.0, starCell.x)
      ) * starSeed;

    float shard = step(
      0.72,
      abs(sin(uv.x * 33.0 + uv.y * 17.0 + time)) *
        abs(sin(uv.x * 11.0 - uv.y * 29.0))
    );

    float etched = pow(
      0.5 + 0.5 * sin((uv.y * 155.0 + uv.x * 44.0 + tiltSweep * 8.0) * 3.1415926),
      16.0
    );

    float sparkleSeed = hash(floor(uv * vec2(95.0, 138.0)) + floor(time * 10.0));
    float sparkle = step(0.982, sparkleSeed);

    vec3 prism = rainbow(uv.x * 0.65 + uv.y * 0.45 + time * 0.08 + tiltSweep * 0.12);
    vec3 gold = vec3(1.0, 0.72, 0.18);
    vec3 platinum = vec3(0.82, 0.92, 1.0);
    vec3 spectral = vec3(0.82, 0.90, 1.0);

    vec3 foil = vec3(0.0);
    foil += prism * (broadSweep * 0.30 + fineSweep * 0.14);
    foil += prism * diagonal * uDiagonal * 0.72;
    foil += prism * lines * uLine * 0.22;
    foil += prism * dots * uDot * 0.46;
    foil += prism * mosaic * uMosaic * 0.27;
    foil += prism * starShape * uStar * 0.72;
    foil += prism * shard * uShard * 0.32;
    foil += prism * etched * uEtched * 0.18;
    foil += prism * sparkle * uSparkle * 0.84;
    foil += gold * (uGold * (broadSweep * 0.42 + borderMask * 0.14 + nameMask * 0.14));
    foil += platinum * (uPlatinum * (broadSweep * 0.34 + fineSweep * 0.14));
    foil += spectral * (uSpectral * (0.12 + broadSweep * 0.22 + fineSweep * 0.10));

    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    float brightener = mix(0.42, 0.88, 1.0 - luminance);
    vec3 lifted = color + foil * targetMask * brightener * uIntensity * foilVisibility;
    color = mix(color, lifted, targetMask * mix(0.18, 0.66, tiltResponse));
    color += targetMask * (broadSweep + fineSweep) * uIntensity * foilVisibility * 0.018;
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, base.a);
  }
`;

function normalizeRarity(rarity: string | null | undefined) {
  return rarity
    ?.toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function profile(overrides: Partial<HoloProfile>): HoloProfile {
  return { ...defaultProfile, ...overrides };
}

const ultimateRareProfile = profile({
  art: 0.72,
  border: 0.82,
  etched: 1,
  full: 0.72,
  intensity: 0.92,
  line: 0.35,
  name: 0.45,
  speed: 0.25,
});

export function getHoloProfile(rarity: string | null | undefined) {
  const normalized = normalizeRarity(rarity);

  if (!normalized || normalized === "common") {
    return null;
  }

  return ultimateRareProfile;
}

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    function onChange(event: MediaQueryListEvent) {
      setReducedMotion(event.matches);
    }

    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function profileUniformValues(profile: HoloProfile) {
  return [
    ["uArt", profile.art],
    ["uBorder", profile.border],
    ["uDiagonal", profile.diagonal],
    ["uDot", profile.dot],
    ["uEtched", profile.etched],
    ["uFull", profile.full],
    ["uGold", profile.gold],
    ["uIntensity", profile.intensity],
    ["uLine", profile.line],
    ["uMosaic", profile.mosaic],
    ["uName", profile.name],
    ["uPlatinum", profile.platinum],
    ["uShard", profile.shard],
    ["uSparkle", profile.sparkle],
    ["uSpectral", profile.spectral],
    ["uSpeed", profile.speed],
    ["uStar", profile.star],
  ] as const;
}

export function HolographicCardCanvas({
  alt,
  className = "",
  imageUrl,
  rarity,
  tilt,
}: {
  alt: string;
  className?: string;
  imageUrl: string | null | undefined;
  rarity: string | null | undefined;
  tilt?: Tilt;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tiltRef = useRef({ x: 0, y: 0 });
  const reducedMotion = useReducedMotion();
  const holoProfile = useMemo(() => getHoloProfile(rarity), [rarity]);
  const tiltX = clamp((tilt?.y ?? 0) / 16, -1, 1);
  const tiltY = clamp((tilt?.x ?? 0) / 16, -1, 1);

  useEffect(() => {
    tiltRef.current = {
      x: tiltX,
      y: tiltY,
    };
  }, [tiltX, tiltY]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !imageUrl || !holoProfile) {
      return;
    }

    const canvasElement = canvas;
    const context = canvasElement.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: false,
      stencil: false,
    });

    if (!context) {
      return;
    }

    const gl = context;

    let animationFrame = 0;
    let destroyed = false;
    let textureReady = false;
    let resizeObserver: ResizeObserver | null = null;
    let vertexBuffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;
    let program: WebGLProgram | null = null;
    const image = new Image();

    function cleanup() {
      destroyed = true;
      image.onload = null;
      image.onerror = null;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      gl.deleteBuffer(vertexBuffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );

    if (!vertexShader || !fragmentShader) {
      if (vertexShader) {
        gl.deleteShader(vertexShader);
      }
      if (fragmentShader) {
        gl.deleteShader(fragmentShader);
      }
      return cleanup;
    }

    program = gl.createProgram();

    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return cleanup;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      program = null;
      return cleanup;
    }

    gl.useProgram(program);

    vertexBuffer = gl.createBuffer();

    if (!vertexBuffer) {
      return cleanup;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        1, 1, 1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const uvLocation = gl.getAttribLocation(program, "aUv");

    if (positionLocation < 0 || uvLocation < 0) {
      return cleanup;
    }

    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);

    texture = gl.createTexture();

    if (!texture) {
      return cleanup;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const imageUniform = gl.getUniformLocation(program, "uImage");
    const timeUniform = gl.getUniformLocation(program, "uTime");
    const tiltUniform = gl.getUniformLocation(program, "uTilt");
    const reducedMotionUniform = gl.getUniformLocation(program, "uReducedMotion");
    gl.uniform1i(imageUniform, 0);

    for (const [name, value] of profileUniformValues(holoProfile)) {
      gl.uniform1f(gl.getUniformLocation(program, name), value);
    }

    function resizeCanvas() {
      const rect = canvasElement.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));

      if (
        canvasElement.width !== nextWidth ||
        canvasElement.height !== nextHeight
      ) {
        canvasElement.width = nextWidth;
        canvasElement.height = nextHeight;
      }

      gl.viewport(0, 0, canvasElement.width, canvasElement.height);
    }

    function render(now: number) {
      if (destroyed || !textureReady || !program) {
        return;
      }

      resizeCanvas();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(timeUniform, now / 1000);
      gl.uniform2f(tiltUniform, tiltRef.current.x, tiltRef.current.y);
      gl.uniform1f(reducedMotionUniform, reducedMotion ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!reducedMotion) {
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    image.onload = () => {
      if (destroyed || !texture) {
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      textureReady = true;
      render(performance.now());
    };
    image.onerror = () => {
      textureReady = false;
    };
    image.src = proxiedImageUrl(imageUrl);

    resizeObserver = new ResizeObserver(() => render(performance.now()));
    resizeObserver.observe(canvasElement);

    return cleanup;
  }, [holoProfile, imageUrl, reducedMotion]);

  if (!imageUrl) {
    return (
      <div
        className={`grid place-items-center p-6 text-sm font-semibold text-zinc-500 ${className}`}
      >
        No image
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} className="h-full w-full object-cover" src={imageUrl} />
      {holoProfile ? (
        <canvas
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full rounded-[inherit]"
          ref={canvasRef}
        />
      ) : null}
    </div>
  );
}
