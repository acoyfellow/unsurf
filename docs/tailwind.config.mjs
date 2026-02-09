import starlightPlugin from '@astrojs/starlight-tailwind';
import colors from 'tailwindcss/colors';

export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  plugins: [starlightPlugin()],
  theme: {
    extend: {
      colors: {
        accent: { 
          200: '#93c5fd', 
          600: '#3b82f6', 
          900: '#1e3a5f',
          950: '#0f1d2f',
        },
        gray: {
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          700: '#1f2937',
          800: '#111827',
          900: '#0a0a0a',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
};
