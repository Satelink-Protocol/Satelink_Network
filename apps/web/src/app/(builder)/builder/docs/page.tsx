"use client";
import React, { useEffect, useState } from 'react';

// Dynamically imported to avoid SSR issues with swagger-ui-react
export default function BuilderDocsPage() {
  const [SwaggerUI, setSwaggerUI] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    Promise.all([
      import('swagger-ui-react'),
      import('swagger-ui-react/swagger-ui.css' as any),
    ]).then(([mod]) => {
      setSwaggerUI(() => mod.default);
    });
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {SwaggerUI ? (
        <SwaggerUI
          url="/api-docs"
          docExpansion="list"
          defaultModelsExpandDepth={-1}
        />
      ) : (
        <div className="p-8 text-zinc-500 text-sm">Loading API docs…</div>
      )}
    </div>
  );
}
