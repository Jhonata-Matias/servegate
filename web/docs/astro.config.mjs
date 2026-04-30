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
			components: {
				// V1 is dark-only — suppress the theme toggle (Story 2.9 Decision #6).
				// Light mode is V2 backlog. Revert by removing this override.
				ThemeSelect: './src/components/EmptyComponent.astro',
			},
			sidebar: [
				{ label: 'Welcome', slug: 'index' },
				{ label: 'Quickstart', slug: 'quickstart' },
				{
					label: 'Capabilities',
					items: [
						{ label: 'Generate images', slug: 'generate-images' },
						{ label: 'Edit images', slug: 'edit-images' },
						{ label: 'Generate text', slug: 'generate-text' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'API Reference', slug: 'api' },
						{ label: 'SDK (TypeScript)', slug: 'sdk' },
						{ label: 'Handle errors', slug: 'errors' },
					],
				},
				{
					label: 'Reports',
					items: [{ label: 'RunPod Video Report', slug: 'runpod-video-report' }],
				},
			],
		}),
	],
});
