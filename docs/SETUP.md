# Guía de configuración — HomeHub

## 0. Qué vas a tener al final

Una app web instalable en tu móvil (icono en la pantalla de inicio, como una app normal)
en la que puedes: ver y controlar tus dispositivos, crear rutinas, y hablarle para que
interprete lo que le pides ("enciende la luz del salón", "modo cine") usando Claude.
Todo corre en la nube (Render), sin depender de tu ordenador de casa.

## 1. Antes de nada: crea las credenciales que necesites

Solo necesitas configurar los proveedores que realmente uses. Si no tienes bombillas Tuya,
por ejemplo, sáltate esa sección.

### Samsung TV → SmartThings

La mayoría de TVs Samsung modernas (2018+) se pueden añadir a la app **SmartThings** de Samsung
(la misma que usas para bombillas, si son compatibles).

1. Abre la app SmartThings en tu móvil y asegúrate de que tu TV aparece como un dispositivo.
2. Ve a https://account.smartthings.com/tokens con la misma cuenta y crea un **Personal Access
   Token (PAT)**. Marca al menos los permisos `Devices` (leer y controlar).
3. Copia el token → `SMARTTHINGS_TOKEN` en tu `.env`.

### Bombillas Tuya / Smart Life (o genéricas compatibles)

Si controlas tus bombillas con la app **Smart Life** o **Tuya Smart**, están sobre la
plataforma Tuya:

1. Crea una cuenta en https://iot.tuya.com/ y un proyecto de tipo "Cloud Development".
2. En el proyecto, copia el **Access ID** y **Access Secret** → `TUYA_ACCESS_ID` /
   `TUYA_ACCESS_SECRET`.
3. En el proyecto, ve a "Devices" → "Link Tuya App Account" y vincula la cuenta de tu app
   Smart Life/Tuya escaneando el QR. Esto te da un `UID` → `TUYA_USER_ID`.
4. `TUYA_REGION`: `eu` si tu cuenta es europea (por defecto), `us`/`cn`/`in` si no.

Si tus bombillas son de otra marca "compatible con Alexa/Google" pero no usan Smart Life/Tuya,
dime cuál es la app que usas y añadimos un adaptador para esa API.

### Bombillas Philips Hue (alternativa/adicional)

1. Sigue el flujo de "remote API" de Hue (OAuth) para obtener un `HUE_REMOTE_ACCESS_TOKEN":
   https://developers.meethue.com/develop/hue-api/remote-api-quick-start-guide/
2. El `HUE_BRIDGE_USERNAME` es el "whitelist user" que se genera al vincular una app con tu
   puente Hue (puedes generarlo también localmente antes de migrar a remoto).

### Claude (el "cerebro" que entiende lo que dices)

1. Crea una clave en https://console.anthropic.com/settings/keys
2. Cópiala en `ANTHROPIC_API_KEY`.

### Alexa — LEE ESTO, es importante

Amazon **no** deja que apps de terceros hagan que un Echo diga un texto libre que tú le
mandes. No es una limitación de esta app, es así para todo el mundo. Hay dos formas reales
de conseguir que "Alexa te responda":

**Opción A — Oficial y recomendada (frases fijas):**
1. En SmartThings, crea un dispositivo virtual de tipo "switch" (puedes hacerlo desde la app
   SmartThings → "+" → "Dispositivo virtual").
2. En la app de Alexa: Dispositivos → "+" → Añadir dispositivo → Smart Home → busca e
   inicia sesión con tu skill de SmartThings, para que Alexa descubra ese switch.
3. En la app de Alexa, crea una Rutina: "Cuando [ese switch] se encienda → Alexa dice:
   'Hecho'". Puedes crear varias (una para "ok", otra para "error", etc.).
4. Copia el `externalId` de ese switch (lo verás en la pestaña Dispositivos de HomeHub tras
   sincronizar) y pégalo en `backend/src/adapters/alexa.ts`, en `CANNED_PHRASE_SWITCHES`.

Con esto, cuando le pidas algo a HomeHub, puede hacer que un Echo diga una frase fija de
confirmación (no lo que tú digas literalmente, pero sí una respuesta real desde el altavoz).

**Opción B — No oficial (texto libre, experimental, bajo tu responsabilidad):**
Usa una sesión de tu cuenta de Amazon para llamar a un endpoint interno no documentado.
Puede dejar de funcionar en cualquier momento y no está soportado por Amazon.
1. Inicia sesión en https://alexa.amazon.es en un navegador de escritorio.
2. Con las herramientas de desarrollador (F12 → Network), copia el valor completo de la
   cabecera `Cookie` de cualquier petición a alexa.amazon.es → `ALEXA_COOKIE`.
3. Busca el "serial number" de tu dispositivo Echo (puedes verlo en la respuesta de
   `https://alexa.amazon.es/api/devices-v2/device`) → `ALEXA_ANNOUNCE_DEVICE_SERIAL`.
4. Pon `ALEXA_ANNOUNCE_MODE=unofficial`.

Si no te aclaras con esto, no pasa nada: deja `ALEXA_ANNOUNCE_MODE=routine` (o simplemente
no configures nada de Alexa) y HomeHub seguirá respondiéndote **por voz desde el propio
móvil** (usa la síntesis de voz del navegador), que cubre el "que me responda" en el 90% de
los casos sin depender de Amazon.

**Con la TV, por cierto, pasa algo parecido**: una Samsung TV no tiene forma de "hablar" ni
mostrar texto arbitrario sin una app propia instalada. Sí puede reaccionar (encenderse,
cambiar de canal, subir volumen) a lo que le pidas por voz.

## 2. Desplegar en Render

1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. En Render: New → Blueprint → conecta el repo. Render detectará `render.yaml`
   automáticamente y creará el servicio con un disco persistente para la base de datos.
3. Render te pedirá los valores de las variables marcadas como `sync: false`
   (`ADMIN_USER`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, etc.) — rellénalos con lo que
   preparaste en el paso 1. Elige un usuario/contraseña fuertes: la app queda accesible
   desde internet.
4. Despliega. Cuando termine, Render te da una URL tipo `https://homehub-xxxx.onrender.com`.

Nota sobre el plan: el plan "Starter" de Render (de pago, unos pocos dólares al mes) es el
recomendado porque incluye disco persistente para que la base de datos (tus dispositivos y
rutinas) no se borre en cada despliegue, y evita que el servicio se "duerma" por inactividad
(algo que sí pasa en el plan gratuito y que rompería tus rutinas programadas).

## 3. Primer uso

1. Abre la URL de Render en el navegador del móvil (Chrome recomendado, por el
   reconocimiento de voz).
2. Inicia sesión con el usuario/contraseña que configuraste.
3. En la pestaña "Dispositivos", pulsa "Buscar dispositivos" para importar tu TV y bombillas.
4. Instala la app: en Chrome Android, menú (⋮) → "Añadir a pantalla de inicio". En iPhone,
   Safari → compartir → "Añadir a pantalla de inicio".
5. Ve a la pestaña "Voz" y prueba: "enciende la luz del salón", "apaga la tele".
6. Crea rutinas en la pestaña "Rutinas" (ej. "Modo cine": TV encendida + luces al 20%).

## 4. Limitaciones honestas de esta v1

- El reconocimiento de voz lo hace el navegador (Web Speech API): funciona muy bien en
  Chrome/Android; en iPhone/Safari es más limitado.
- Alexa: como se explica arriba, sin el modo no oficial solo puede reproducir frases fijas
  preconfiguradas, no repetir texto libre.
- La TV Samsung necesita estar registrada en SmartThings; los comandos disponibles
  (encender/apagar, volumen, canal, abrir apps) dependen de lo que tu modelo exponga en esa
  API — algunos modelos más antiguos tienen soporte parcial.
- Tuya: los "code" exactos de brillo/color pueden variar ligeramente según el modelo exacto
  de bombilla; si alguna acción no responde bien, dime el modelo y ajustamos el adaptador.
