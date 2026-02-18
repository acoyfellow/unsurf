import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'static',
  vite: {
    server: {
      allowedHosts: ['workbot.exe.xyz'],
    },
  },
  site: 'https://unsurf.coey.dev',
  integrations: [
    starlight({
      title: 'unsurf',
      description: 'Turn any website into a typed API',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/acoyfellow/unsurf' },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
      },
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Introduction', slug: '' },
            { label: 'Your first unsurf', slug: 'tutorial' },
          ],
        },
        {
          label: 'How-to Guides',
          items: [
            { label: 'Scout a website', slug: 'guides/scout' },
            { label: 'Replay a captured API', slug: 'guides/replay' },
            { label: 'Heal a broken path', slug: 'guides/heal' },
            { label: 'Agent integration', slug: 'guides/agent-integration' },
            { label: 'MCP Server', slug: 'guides/mcp' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'MCP Tools', slug: 'reference/tools' },
            { label: 'Configuration', slug: 'reference/config' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'How unsurf works', slug: 'concepts/how-it-works' },
            { label: 'Agent patterns', slug: 'concepts/agent-patterns' },
            { label: 'Agent safety guardrails', slug: 'concepts/safety' },
          ],
        },
      ],
    }),
    tailwind({ applyBaseStyles: false }),
  ],
});
