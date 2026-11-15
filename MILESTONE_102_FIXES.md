# Milestone 102: Camera mode type correction

Updated apps/node-service/src/index.ts to display the actual CameraMode properties (`fps`, `pixelFormat`) rather than nonexistent `minFps`, `maxFps`, and `codec`. This addresses the three reported TypeScript errors. Full build not executed here.
