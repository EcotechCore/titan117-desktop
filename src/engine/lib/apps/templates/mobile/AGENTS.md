# How this mobile app is built

Made with Titan117's app builder. Notes for anyone (or any coding agent) changing it.

- **Stack:** Expo SDK 58, React Native 0.88, React 19, TypeScript. The app starts in `index.ts`; screens and components live in `src/`. Colours are in `src/theme.ts` (light and dark).
- **One code base, three places:** the same code runs on Android and iPhone (in Expo Go or a real build) and in a browser through react-native-web, which is how Titan117 previews and tests it on the laptop. Use React Native components (`View`, `Text`, `Pressable`, `ScrollView`, `Image`, `TextInput`), never HTML tags or CSS files.
- **Commands:** `npm run dev` (preview in the browser), `npm run phone` (open in Expo Go on a phone on the same Wi-Fi), `npm run typecheck`, `npm run build` (the web export), `npm test`. Typecheck, build and tests must pass.
- **Packages:** only Expo SDK 58 packages and pure JavaScript ones, so the app keeps working in Expo Go. A package with its own native code needs a development build: ask first.
- **Phones first:** tap targets at least 44 points, text at least 16, `accessibilityRole` and `accessibilityLabel` on buttons and images, safe areas respected, dark mode through `useColorScheme()`.
- **Tests:** `src/*.test.tsx` with Vitest; they render with react-native-web and `react-dom/server` (no phone needed). An Expo module that needs a phone gets a small stand-in in `test-stubs/`, named in `vitest.config.ts`.
- **Name and description** live in `app.json` (`expo.name`, `expo.description`).
- **No secrets** in the code or in `.env` files committed to git.
