import type { SVGProps } from "react";

const sharedIconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "square",
  strokeLinejoin: "miter",
  "aria-hidden": true,
} as const;

export function GeneralEducationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...sharedIconProps} {...props}>
      <path d="M3 20h18" />
      <path d="M6 15v5M12 10.5V20M18 15v5" />
      <path d="m6 8.5 3.5 3.25L6 15l-3.5-3.25L6 8.5Z" />
      <path d="m12 4 3.5 3.25L12 10.5 8.5 7.25 12 4Z" />
      <path d="m18 8.5 3.5 3.25L18 15l-3.5-3.25L18 8.5Z" />
    </svg>
  );
}

export function MajorFoundationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...sharedIconProps} {...props}>
      <path d="m3 17.5 9 4.25 9-4.25-9-4.25-9 4.25Z" />
      <path d="m6.25 11.5 5.75 2.75 5.75-2.75L12 8.75 6.25 11.5Z" />
      <path d="m9.25 6 2.75 1.4 2.75-1.4L12 4.6 9.25 6Z" />
    </svg>
  );
}

export function MajorCoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...sharedIconProps} {...props}>
      <path d="m12 3 9 9-9 9-9-9 9-9Z" />
      <path d="m12 7 5 5-5 5-5-5 5-5Z" />
      <path d="m12 9.75 2.25 2.25L12 14.25 9.75 12 12 9.75Z" fill="currentColor" fillOpacity=".18" />
    </svg>
  );
}

export function MajorModuleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...sharedIconProps} {...props}>
      <path d="M17.75 5.25A8.5 8.5 0 1 0 20.5 12" />
      <path d="m7 16.5 4.5-4.5 3 3 5.25-5.25" />
      <path d="M16.5 9.75h3.25V13" />
    </svg>
  );
}
