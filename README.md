# HomeHub

Centro de domótica personalizado: controla tu TV Samsung, bombillas y (con matices) Alexa,
crea rutinas, y habla con la app desde el móvil para que haga lo que le pidas.

100% en la nube: no necesitas tener ningún ordenador encendido en casa. La app corre en un
servicio como [Render](https://render.com) y controla tus dispositivos a través de las APIs
en la nube de cada fabricante (Samsung SmartThings, Tuya, Philips Hue).

Ver **[docs/SETUP.md](docs/SETUP.md)** para la guía completa paso a paso (credenciales, despliegue,
instalación como app en el móvil, y las limitaciones reales de Alexa).

## Estructura

```
homehub/
├── backend/          # API en Node.js/TypeScript + frontend estático (PWA)
│   ├── src/
│   │   ├── adapters/     # SmartThings, Tuya, Hue, Alexa
│   │   ├── routes/       # endpoints REST
│   │   ├── services/     # gestor de dispositivos, rutinas, NLU (Claude)
│   │   └── index.ts
│   └── public/       # la app web (PWA) que instalas en el móvil
├── docs/SETUP.md     # guía de configuración y despliegue
└── render.yaml        # despliegue con un clic en Render
```

## Desarrollo local

```bash
cd backend
cp .env.example .env   # rellena tus credenciales
npm install
npm run dev
```

Abre http://localhost:3000
