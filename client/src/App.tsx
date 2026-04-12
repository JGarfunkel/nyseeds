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
  
  // Redirect root to /ordinizer
  if (pathname === '/') {
    window.location.href = '/ordinizer';
    return null;
  }
  
  return (
    <Switch>
      {/* Root - redirect handled above */}
      
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
