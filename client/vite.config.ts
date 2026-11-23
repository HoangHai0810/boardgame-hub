import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// base './' so the same build works on GitHub Pages subpaths and any static host.
export default defineConfig({ plugins: [react()], base: './' });
