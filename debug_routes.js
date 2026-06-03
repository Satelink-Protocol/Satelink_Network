
import express from "express";
import { createApp } from "./app_factory.mjs";

// Mock DB
const db = {
    prepare: (sql) => ({
        get: () => ({}),
        all: () => []
    })
};

const app = createApp(db);

console.log('[DEBUG] Registered Routes:');
app._router.stack.forEach((middleware) => {
    if (middleware.route) {
        console.log(`ROUTE: ${Object.keys(middleware.route.methods).join(',').toUpperCase()} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
        console.log(`ROUTER: ${middleware.regexp}`);
    }
});
