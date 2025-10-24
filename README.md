# Samplesite - Ordinizer Integration Example

This is a minimal example showing how to integrate the Ordinizer library into your own website.

## Overview

Samplesite demonstrates clean integration of Ordinizer:
- Ordinizer app mounted at `/ordinizer` routes
- Ordinizer API endpoints at `/api/ordinizer`
- Self-contained data directory at `samplesite/data/`
- Host app provides shadcn/ui components via alias

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up shadcn/ui Components

The ordinizer app uses shadcn/ui components. Your host application must provide these components.

**Option A: Using shadcn CLI (Recommended)**

shadcn/ui is not an npm package - it's a CLI that copies component source code into your project:

```bash
# Initialize shadcn in your project
npx shadcn@latest init

# When prompted, answer:
# - TypeScript: Yes
# - Style: Default or your preference
# - Base color: Slate or your preference
# - CSS variables: Yes
# - tailwind.config: Use defaults

# Add required components
npx shadcn@latest add badge button card command dialog input popover scroll-area select separator skeleton toast tooltip
```

**Option B: Manual Copy (If CLI doesn't work)**

If the CLI installation fails, you can manually copy components from another shadcn project:

1. Create directories:
```bash
mkdir -p client/src/components/ui
mkdir -p client/src/lib
mkdir -p client/src/hooks
```

2. Copy component files (from another shadcn project or the shadcn website):
   - **UI Components** (`client/src/components/ui/`): badge.tsx, button.tsx, card.tsx, command.tsx, dialog.tsx, input.tsx, popover.tsx, scroll-area.tsx, select.tsx, separator.tsx, skeleton.tsx, toast.tsx, toaster.tsx, tooltip.tsx
   - **Utilities** (`client/src/lib/`): utils.ts
   - **Hooks** (`client/src/hooks/`): use-toast.ts

3. **Important**: Update all imports in copied files to use the `@/` alias:
```typescript
// Change this:
import { cn } from "../lib/utils"

// To this:
import { cn } from "@/lib/utils"
```

4. Create `client/src/components/ui/index.ts` to export all components (see samplesite example)

### 3. Configure Path Aliases

Update your `vite.config.ts`:

```typescript
resolve: {
  alias: {
    "@": path.resolve(import.meta.dirname, "client", "src"),
    "@shared": path.resolve(import.meta.dirname, "shared"),
    "@ordinizer/client/ui": path.resolve(import.meta.dirname, "client", "src", "components", "ui", "index.ts"),
    "@ordinizer/client": path.resolve(import.meta.dirname, "../ordinizer/client/src/index.ts"),
  },
}
```

Update your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./client/src/*"],
      "@shared/*": ["./shared/*"],
      "@ordinizer/client/ui": ["./client/src/components/ui/index.ts"],
      "@ordinizer/client": ["../ordinizer/client/src/index.ts"]
    }
  }
}
```

### 4. Configure Tailwind CSS

Update your `tailwind.config.ts` to scan ordinizer files:

```typescript
export default {
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,jsx,ts,tsx}",
    "../ordinizer/app/client/src/**/*.{js,jsx,ts,tsx}",  // Ordinizer app pages
    "../ordinizer/client/src/**/*.{js,jsx,ts,tsx}",      // Ordinizer UI components
  ],
  // ... rest of config
}
```

### 5. Set Up Data Directory

Create a data directory for your realm:

```bash
mkdir -p data
```

Copy or create your realm data:
- `realms.json` - Define your realms
- `{realm-id}/` - Realm-specific data directories

See `samplesite/data/` for an example structure.

### 6. Integrate Ordinizer into Your App

**Server-side** (`server/routes.ts`):

```typescript
import { registerRoutes as registerOrdinizerRoutes } from "../../ordinizer/app/server/routes";
import path from "path";

// Register ordinizer routes
registerOrdinizerRoutes(
  app,
  "/api/ordinizer",  // API prefix
  path.join(process.cwd(), "samplesite", "data")  // Data directory path
);
```

**Client-side** (`client/src/App.tsx`):

```typescript
import { Route } from "wouter";
import OrdinizerApp from "../../../ordinizer/app/client/src/App";

<Route path="/ordinizer*">
  <OrdinizerApp basePath="/ordinizer" />
</Route>
```

### 7. Import Ordinizer Styles

Add to your `client/src/index.css`:

```css
/* Import Leaflet CSS for maps */
@import 'leaflet/dist/leaflet.css';

/* Your Tailwind and other styles */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Environment Variables

If using external services, set these environment variables:

```bash
OPENAI_API_KEY=your_key_here          # For AI analysis features
PINECONE_API_KEY=your_key_here        # For vector search
GOOGLE_SHEETS_API_KEY=your_key_here   # For data extraction
```

## Running the Application

```bash
npm run dev
```

Visit:
- Home page: `http://localhost:5000/`
- Ordinizer app: `http://localhost:5000/ordinizer`

## Project Structure

```
samplesite/
├── client/
│   ├── src/
│   │   ├── components/ui/     # shadcn components (host provides)
│   │   ├── lib/               # Utility functions
│   │   ├── hooks/             # React hooks
│   │   ├── App.tsx            # Main router
│   │   └── index.css          # Styles
│   └── index.html
├── server/
│   ├── routes.ts              # Register ordinizer routes
│   └── index.ts
├── data/                      # Ordinizer data directory
│   ├── realms.json
│   └── {realm-id}/
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Key Integration Points

1. **shadcn Components**: Host app provides UI components via `@ordinizer/client/ui` alias
2. **Data Path**: Configure data directory when registering routes
3. **Tailwind Scanning**: Include ordinizer paths in Tailwind content array
4. **Route Mounting**: Mount OrdinizerApp at desired base path (e.g., `/ordinizer`)
5. **API Prefix**: Register API routes with custom prefix (e.g., `/api/ordinizer`)

## Notes

- Ordinizer is designed to be a lightweight library - it doesn't bundle shadcn components
- The host application is responsible for providing shadcn/ui components
- Each integration can use its own data directory and realm configuration
- Multiple ordinizer instances can coexist in the same application with different base paths

## How Routing and BasePath Work

Ordinizer uses a sophisticated routing system to support being mounted at different base paths.

### BasePath Architecture

The `basePath` prop passed to `OrdinizerApp` serves two key purposes:

1. **Link Generation**: All navigation links (using `Link` or `navigate()`) automatically prepend the basePath
2. **API Calls**: All API requests automatically use the correct API prefix

### Route Definitions

Routes inside `ordinizer/app/client/src/App.tsx` are defined as **relative paths** (e.g., `/realm/:realmid/:domain`). When OrdinizerApp is mounted at `/ordinizer*`, wouter's nested routing handles the path resolution automatically.

**Example flow**:
- User clicks link to `/ordinizer/realm/westchester-municipal-environmental/trees`
- Samplesite's router matches `/ordinizer*` → renders `<OrdinizerApp basePath="/ordinizer" />`
- Ordinizer's router matches relative path `/realm/:realmid/:domain`
- Home component receives params: `realmid=westchester-municipal-environmental`, `domain=trees`

### BasePathContext

The `BasePathContext` provides the `buildPath()` function throughout the ordinizer app:

```typescript
import { useBasePath } from '../contexts/BasePathContext';

function MyComponent() {
  const { buildPath } = useBasePath();
  
  // buildPath prepends the basePath automatically
  navigate(buildPath('/realm/my-realm'));  // → /ordinizer/realm/my-realm
}
```

### API Configuration

The `apiPath()` function in `ordinizer/app/client/src/lib/apiConfig.ts` handles API prefixing:

```typescript
// When VITE_ORDINIZER_API_PREFIX=/api/ordinizer (default):
apiPath('realms')  // → /api/ordinizer/realms
```

### PostCSS and Tailwind CSS Setup

**Important**: The PostCSS configuration must use CommonJS format and explicitly specify the Tailwind config path with absolute content paths. This is necessary when Tailwind needs to scan files from external directories like ordinizer.

See `samplesite/client/postcss.config.cjs` for the correct setup:

```javascript
const path = require('path');

module.exports = {
  plugins: [
    require('tailwindcss')(path.resolve(__dirname, 'tailwind.config.ts')),
    require('autoprefixer'),
  ],
};
```

And in `tailwind.config.ts`, use absolute paths for content scanning:

```typescript
content: [
  path.resolve(__dirname, 'client/index.html'),
  path.resolve(__dirname, 'client/src/**/*.{js,jsx,ts,tsx}'),
  path.resolve(__dirname, '../ordinizer/app/client/src/**/*.{js,jsx,ts,tsx}'),
],
```

## Troubleshooting

### Components not styling correctly
- Verify Tailwind is scanning ordinizer files (check `tailwind.config.ts`)
- Ensure CSS variables are defined in `index.css`

### Import errors
- Check that `@ordinizer/client/ui` alias points to your components directory
- Verify all component files use `@/` alias for imports

### Data not loading
- Confirm data directory path is correct in route registration
- Check `realms.json` exists and is properly formatted

### Routes not working (404 or wrong page)
- Verify parent route uses wildcard: `<Route path="/ordinizer*">` (note the `*`)
- Check that ordinizer route definitions are relative (no basePath prefix)
- Ensure basePath prop matches the mounting point: `<OrdinizerApp basePath="/ordinizer" />`
- Confirm API prefix matches backend registration: `/api/ordinizer`

## Keeping Components Out of Source Control (Optional)

If you want to keep shadcn components out of your repository:

1. Add to `.gitignore`:
```gitignore
# shadcn/ui components - generated during setup
client/src/components/ui/
client/src/lib/utils.ts
client/src/hooks/use-toast.ts
```

2. Create a setup script to install components during deployment
3. See `.gitignore.example` for a complete example

This keeps your repository lightweight while maintaining the components locally during development.

## License

This is a sample integration. Adapt it to your needs.
