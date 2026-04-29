// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://deploy-lp-one.vercel.app',
	integrations: [
		starlight({
			title: 'servegate',
			description: 'Open-source gateway and TypeScript SDK for FLUX.1-schnell, Qwen-Image-Edit and Gemma 4 — async submit/poll contract over an authenticated HTTP API.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Jhonata-Matias/servegate' },
			],
			editLink: {
				baseUrl: 'https://github.com/Jhonata-Matias/servegate/edit/main/web/docs/',
			},
			customCss: ['./src/styles/theme.css'],
			sidebar: [
				{ label: 'Welcome', slug: 'index' },
				{
					label: 'Get started',
					items: [{ label: 'Quickstart', slug: 'quickstart' }],
				},
				{ label: 'API Reference', slug: 'api' },
				{ label: 'SDK (TypeScript)', slug: 'sdk' },
				{ label: 'Errors', slug: 'errors' },
			],
		}),
	],
});
