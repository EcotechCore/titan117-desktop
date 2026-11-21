# Five sample web apps with qwen/qwen3-coder-next

## Cluj Bakery (restaurant)

Task: done, 3 steps, $0.0347. Checks: pass.

Asked:
- app_create: Make a new web app "Cluj Bakery" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1
- app_plan: Build this plan in "Cluj Bakery"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each c

Versions:
- Built: Build a one-page site with:
- Version 1: a new web app, "Cluj Bakery", from the template

```
All checks passed (typecheck, build, test, browsers).
```

## Ana Plumbing (services)

Task: stopped, 25 steps, $0.1220. Checks: fail.

Asked:
- app_create: Make a new web app "Ana Plumbing" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1
- app_plan: Build this plan in "Ana Plumbing"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 
- write_file: Write 619 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- write_file: Write 789 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing; npm test -- --run · runs cd
- write_file: Write 785 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing; npm test -- --run · runs cd
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src; if (Test-Path "..\site.config.json") { "Found at ../" } 
- write_file: Write 782 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing; npm test -- --run · runs cd
- write_file: Write 810 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing; npm test -- --run · runs cd
- write_file: Write 234 B to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing\src\App.test.tsx
- run_command: Run: cd C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ana-plumbing; npm test -- --run · runs cd

Versions:
- Built (checks failing): Build a three-page services site for Ana Plumbing:
- Version 1: a new web app, "Ana Plumbing", from the template

```
Checks found 2 problem(s).
✗ typecheck:
> ana-plumbing@0.1.0 typecheck
> tsc --noEmit

src/App.test.tsx(3,17): error TS2307: Cannot find module '../pages/AppPages' or its corresponding type declarations.
src/App.test.tsx(4,18): error TS2307: Cannot find module '../../site.config.json' or its corresponding type declarations.
✗ test:
> ana-plumbing@0.1.0 test
> vitest run


 RUN  v5.1.1 C:/Users/dniss/AppData/Local/Temp/titan117-samples-ozBeI1/ana-plumbing

 ❯ src/App.test.tsx (0 test)
 ✓ src/components/Card.test.tsx (2 tests) 18ms
 ✓ src/pages/Contact.test.tsx (4 tests) 24ms
 ✓ src/components/HeroSection.test.tsx (3 tests) 21ms
 ✓ src/pages/Services.test.tsx (4 tests) 22ms
 ✓ src/pages/Home.test.tsx (4 tests) 27ms
 ✓ src/components/FAQSection.test.tsx (1 test) 13ms
 ✓ src/components/ServicesSection.test.tsx (3 tests) 23ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/App.test.tsx [ src/App.test.tsx ]
Error: Cannot find module '../pages/AppPages' imported from C:/Users/dniss/AppData/Local/Temp/titan117-samples-ozBeI1/ana-plumbing/src/App.test.tsx
 ❯ src/App.test.tsx:3:1
      1| import { renderToString } from 'react-dom/server'
      2| import { describe, expect, it } from 'vitest'
      3| import App from '../pages/AppPages'
       | ^
      4| import site from '../../site.config.json'
      5|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 7 passed (8)
      Tests  21 passed (21)
   Start at  20:29:43
   Duration  345ms (import 51%, tests 22%, transform 21%, worker 7%)
```

## Atelier Lemn (shop)

Task: done, 5 steps, $0.1395. Checks: pass.

Asked:
- app_create: Make a new web app "Atelier Lemn" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1
- app_plan: Build this plan in "Atelier Lemn"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\atelier-lemn: rm "C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1

Versions:
- Built: Build a one-page shop site with these sections:
- Version 1: a new web app, "Atelier Lemn", from the template

```
All checks passed (typecheck, build, test, browsers).
```

## Ioana Pop Photography (portfolio)

Task: error, 14 steps, $0.1846. Checks: fail.

Asked:
- app_create: Make a new web app "Ioana Pop Photography" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1
- app_plan: Build this plan in "Ioana Pop Photography"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a versi
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ioana-pop-photography: mkdir -p "C:\Users\dniss\AppData\Local\Temp\titan117
- write_file: Write 1.2 KB to C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1\ioana-pop-photography\src\App.tsx

Versions:
- Version 1: a new web app, "Ioana Pop Photography", from the template

```
Checks found 31 problem(s).
✗ typecheck:
> ioana-pop-photography@0.1.0 typecheck
> tsc --noEmit

src/App.tsx(1,25): error TS6133: 'Navigate' is declared but its value is never read.
src/components/Button.tsx(20,6): error TS2322: Type '{ children: ReactNode; disabled?: boolean | undefined; form?: string | undefined; formAction?: string | ((formData: FormData) => void | Promise<void>) | undefined; ... 283 more ...; className: string; }' is not assignable to type 'AnchorHTMLAttributes<HTMLAnchorElement>'.
  Types of property 'onCopy' are incompatible.
    Type 'ClipboardEventHandler<HTMLButtonElement> | undefined' is not assignable to type 'ClipboardEventHandler<HTMLAnchorElement> | undefined'.
      Type 'ClipboardEventHandler<HTMLButtonElement>' is not assignable to type 'ClipboardEventHandler<HTMLAnchorElement>'.
        Type 'HTMLButtonElement' is missing the following properties from type 'HTMLAnchorElement': charset, coords, download, hreflang, and 19 more.
src/components/ContactInfo.tsx(1,1): error TS6133: 'Link' is declared but its value is never read.
src/components/Navbar.tsx(2,1): error TS6133: 'cn' is declared but its value is never read.
✗ test:
 ❯ renderNodeDestructive node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:6717:11

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/components/Navbar.test.tsx > Navbar > renders the logo and navigation links
TypeError: Cannot destructure property 'basename' of 'React10.useContext(...)' as it is null.
 ❯ LinkWithRef node_modules/react-router/dist/development/chunk-GNGMS2XR.mjs:7701:11
 ❯ Object.react_stack_bottom_frame node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:10371:18
 ❯ renderWithHooks node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:5361:19
 ❯ renderElement node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:6344:39
 ❯ retryNode node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js:6783:21
 ❯ renderNodeDe
```

## Tax Day 2027 (landing)

Task: done, 3 steps, $0.0392. Checks: pass.

Asked:
- app_create: Make a new web app "Tax Day 2027" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-ozBeI1
- app_plan: Build this plan in "Tax Day 2027"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: Build a landing page for a free one-day workshop on Romanian e-invoici
- Version 1: a new web app, "Tax Day 2027", from the template

```
All checks passed (typecheck, build, test, browsers).
```


## Summary

| App | Checks | Versions | Steps | Cost | Minutes |
|---|---|---|---|---|---|
| Cluj Bakery | pass | 2 | 3 | $0.035 | 4.0 |
| Ana Plumbing | FAIL | 2 | 25 | $0.122 | 9.8 |
| Atelier Lemn | pass | 2 | 5 | $0.140 | 8.5 |
| Ioana Pop Photography | FAIL | 1 | 14 | $0.185 | 8.0 |
| Tax Day 2027 | pass | 2 | 3 | $0.039 | 3.8 |