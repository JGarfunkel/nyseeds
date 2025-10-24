/**
 * Sample Site - Minimal wrapper demonstrating how to integrate Ordinizer
 * 
 * This is a sample website that shows how to host Ordinizer as one component
 * among potentially multiple applications. Other applications can be added here.
 */
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster, TooltipProvider } from "@ordinizer/client/ui";
import OrdinizerApp from "@ordinizer/app/App";
import { queryClient } from "./lib/queryClient";

function Router() {
  // Check if path starts with /ordinizer and render accordingly
  const pathname = window.location.pathname;
  
  if (pathname.startsWith('/ordinizer')) {
    return <OrdinizerApp basePath="/ordinizer" />;
  }
  
  return (
    <Switch>
      {/* Root - Simple landing page */}
      <Route path="/">
        {() => (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4">Sample Site</h1>
              <p className="text-lg text-gray-600 mb-8">
                A sample website demonstrating Ordinizer integration
              </p>
              <a
                href="/ordinizer"
                className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                data-testid="link-ordinizer"
              >
                Launch Ordinizer →
              </a>
            </div>
          </div>
        )}
      </Route>
      
      {/* 404 fallback */}
      <Route>
        {() => (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
              <p className="text-xl text-gray-600 mb-8">Page not found</p>
              <a
                href="/"
                className="text-green-600 hover:text-green-700 underline"
              >
                Return home
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
