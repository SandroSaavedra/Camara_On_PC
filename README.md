# iPhone Cam

Usa la cámara del iPhone como cámara de la PC, al estilo DroidCam. En el iPhone no se instala nada: solo se usa Safari. En la PC basta con `iphone-cam.exe` (o Node.js si se ejecuta desde el código). El video viaja directamente del iPhone a la PC por WebRTC dentro de la red WiFi. El servidor solo entrega las páginas y conecta las dos partes.

```
iPhone (Safari /cam) ──WebRTC──▶ Visor PC (Chrome /  u  OBS /obs) ──▶ OBS ──▶ TikTok LIVE Studio
```

## Inicio rápido

### Usar el .exe (Windows, sin instalar nada)

1. Haz doble clic en `iphone-cam.exe`. Se abre una consola con las URLs y un **código QR**.
   - La primera vez Windows SmartScreen puede decir *"Windows protegió tu PC"*: pulsa **Más información → Ejecutar de todas formas**. El .exe no está firmado.
   - Si el Firewall de Windows pregunta, permite el acceso en **redes privadas**. El aviso puede mostrar el nombre *Node.js*.
2. En el iPhone (misma red WiFi), escanea el QR con la app **Cámara**. Se abre la URL de **Cámara** en Safari, por ejemplo `https://192.168.1.10:8443/cam`.
3. Acepta el aviso del certificado (solo la primera vez) y pulsa **Iniciar cámara**.
4. Para ver el video en la PC, usa **una** de estas dos opciones:
   - Navegador: `https://localhost:8443/`
   - OBS: Fuente de navegador con `http://localhost:8080/obs` (ver más abajo)

El QR solo abre la URL: el iPhone sigue usando Safari. Si no puedes escanearlo, escribe en Safari la URL de **Cámara** que muestra la consola.

### Desde el código

Requiere Node.js 20 o superior.

```
npm install
npm start
```

Después sigue los pasos 2 a 4 de arriba.

> Solo se admite **un visor a la vez**. Si se abre otro, el anterior se desconecta y muestra un aviso.

## Requisitos

| Qué | Detalle |
|-----|---------|
| PC | Windows con `iphone-cam.exe`, o Node.js 20+ para ejecutarlo desde el código. |
| Red | La PC y el iPhone en la misma red WiFi. |
| Firewall | Permite el acceso en **redes privadas** cuando Windows lo pregunte. |

## URLs y puertos

| URL | Protocolo | Para qué |
|-----|-----------|----------|
| `https://<IP-PC>:8443/cam` | HTTPS | iPhone. Safari exige HTTPS para usar la cámara. |
| `https://localhost:8443/` | HTTPS | Visor en el navegador de la PC, con barra y estadísticas. |
| `http://localhost:8080/obs` | HTTP (solo esta PC) | Fuente de navegador de OBS: solo video, con fondo transparente. |

Para cambiar los puertos, pásalos como argumentos (HTTPS y OBS), por ejemplo `iphone-cam.exe 9443 9080` o `npm start -- 9443 9080`.

## Uso en OBS

1. **Ajustes → Vídeo**: resolución base y de salida en `1080x1920` y 30 FPS.
2. **Fuentes → + → Navegador**:
   - URL: `http://localhost:8080/obs`
   - Ancho `1080`, Alto `1920` (con el iPhone en horizontal: `1920 x 1080`)
   - Desmarca **Apagar fuente cuando no esté visible**.
3. Mientras no llega video, la fuente muestra un cartel de estado. El cartel desaparece cuando el video empieza.

Para llenar toda la fuente recortando los bordes, usa `http://localhost:8080/obs?fit=cover`.

## Transmitir con TikTok LIVE Studio

1. En OBS, pulsa **Iniciar cámara virtual**. En su engranaje elige *Tipo de salida: Programa*.
2. En LIVE Studio: **Añadir fuente → Cámara → OBS Virtual Camera**.
   - **Resolución:** `1080*1920`. Con 360\*640 la imagen se ve borrosa.
   - Si los textos aparecen al revés, pulsa **Girar**.
3. Revisa el micrófono en LIVE Studio. La cámara virtual de OBS **no lleva audio**.
4. **Iniciar LIVE**.

Otra opción: transmitir directamente desde OBS con la clave de transmisión de TikTok (**Ajustes → Emisión → Personalizado**). Se pierde menos calidad, pero la clave solo está disponible para cuentas habilitadas y puede cambiar en cada transmisión.

## Controles

**iPhone (`/cam`)**: cámara trasera o frontal, y resolución (1080p, 720p, 480p o 4K experimental). La línea de estado muestra lo que **captura** la cámara y lo que **envía** WebRTC.

**Visor en la PC (`/`)**: Espejo, Rotar, Pantalla completa, Ventana flotante y **Modo captura** (oculta la barra; se vuelve a mostrar con la tecla `H` o con doble clic). Las estadísticas muestran resolución, fps, Mbps, paquetes perdidos y códec.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| La consola del .exe muestra un error y pide **Enter** | No pudo arrancar (por ejemplo, un puerto ocupado) | Lee el mensaje, corrige la causa y vuelve a abrirlo. |
| Windows no deja abrir el .exe | SmartScreen bloquea programas sin firma | **Más información → Ejecutar de todas formas**. |
| `El puerto 8443 ya esta en uso` | Quedó otra instancia abierta | Ciérrala o usa otros puertos. |
| La fuente de OBS no muestra nada | Puerto equivocado o iPhone desconectado | La URL debe ser `http://localhost:8080/obs` (no 8443). En el iPhone pulsa **Iniciar cámara**. |
| `[-] cam desconectado` en la consola | El iPhone bloqueó la pantalla o se cambió de app | Mantén Safari en primer plano y el iPhone cargando. |
| Imagen pixelada (ej. 270x480) | WebRTC redujo la resolución por la red | Revisa la línea de estado del iPhone. Si dice `limitado: bandwidth`, acércate al router o usa WiFi de 5 GHz. |
| Nítido en OBS pero borroso en TikTok | Resolución baja de la cámara virtual en LIVE Studio | Elige `1080*1920` en la fuente y calidad alta en los ajustes de LIVE Studio. |
| Todo se traba o se reconecta sin parar | Dos visores abiertos | Deja abierto solo OBS **o** el navegador. |
| LIVE Studio: "dispositivo ocupado" | Se eligió una webcam que ya está usando OBS | Elige **OBS Virtual Camera**. |

## Compilar el .exe

```
npm install
npm run build
```

El resultado es `dist/iphone-cam.exe` (unos 90 MB, porque incluye Node.js). Se puede copiar a cualquier carpeta o PC con Windows: lleva dentro la versión de Node.js con la que se compiló (Node SEA). Los archivos del certificado se crean junto al .exe.

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `iphone-cam.js` | El servidor y las páginas, en un solo archivo. |
| `package.json` | Dependencias (`selfsigned` para el certificado, `qrcode` para el QR) y scripts `start`, `test` y `build`. |
| `scripts/build.js`, `sea-config.json` | Compilación del .exe con Node SEA. |
| `test/` | Prueba de humo (`npm test`): certificado y rutas principales. |
| `cert.pem`, `key.pem` | El certificado autofirmado. Se genera solo, junto al .exe o al script, y está en `.gitignore`. Para crearlo de nuevo, bórralos. |
