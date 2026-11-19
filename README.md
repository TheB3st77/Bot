 omo meto los comandos al bot necesito ayufa no lo puedes meter por el token?# ESKMC MEDIA MANAGER

Bot real de Discord construido con Node.js, discord.js v14 y SQLite. Los puntos, rangos, plantillas, solicitudes, recompensas e historial se conservan en `data/eskmc.sqlite` entre reinicios.

## Requisito de seguridad

Si un token de bot se compartió en un chat o se publicó por error, **revócalo inmediatamente** en [Discord Developer Portal](https://discord.com/developers/applications) y genera uno nuevo. No publiques el token ni lo guardes en el repositorio. Usa únicamente el archivo local `.env`, que está excluido de Git.

## Preparación

1. Instala Node.js 20 o posterior.
2. Crea una aplicación y un bot en Discord Developer Portal. Copia el ID de aplicación y el token recién generado.
3. En **Bot → Privileged Gateway Intents**, habilita **Server Members Intent**. Es necesario para asignar roles.
4. Invita al bot con los scopes `bot` y `applications.commands`. Concede solamente los permisos necesarios: ver canales, enviar mensajes, insertar enlaces, adjuntar archivos, leer historial y gestionar roles. No concedas Administrador.
5. Clona o copia este proyecto y ejecuta:

   ```sh
   npm install
   cp .env.example .env
   ```

6. Completa `.env`:

   ```dotenv
   DISCORD_TOKEN=token_nuevo_del_bot
   DISCORD_CLIENT_ID=id_de_la_aplicacion
   DISCORD_GUILD_ID=id_del_servidor
   ```

   `DISCORD_GUILD_ID` es opcional, pero recomendado para registrar comandos al instante durante la configuración. Sin él, los comandos se registran globalmente y Discord puede tardar en propagarlos.

7. Registra los comandos y arranca el bot:

   ```sh
   npm run deploy
   npm start
   ```

## Configuración en Discord

Primero asigna **Gestionar servidor** a los administradores que ejecutarán `/configurar`.

- `/configurar canales`: establece los canales de revisión de `head-chat`, evidencias, postulaciones y notificaciones de canjes.
- `/configurar roles`: asigna el rol de Staff autorizado, el rol de verificado y los seis roles de rango. El rol del bot debe estar por encima de todos los roles que administrará.
- `/configurar umbrales`: fija en orden ascendente los puntos mínimos de Mini Media, Media, Media +, Famoso, Partner y Owner Media. Mini Media debe comenzar en 0.

Las operaciones de Staff aceptan el rol configurado o el permiso **Gestionar servidor**. La base de datos se crea automáticamente en `data/`; para alojar el bot persistentemente, conserva esa carpeta y `.env` en almacenamiento seguro.

## Comandos

### Puntos y rangos

- `/puntos`, `/dar-puntos`, `/quitar-puntos`, `/reiniciar-puntos`, `/reiniciar-todos`, `/clasificacion`
- `/rangos`, `/ascender`, `/descender`, `/historial-rangos`

Los cambios de puntos recalculan el rango y actualizan los roles configurados. `/reiniciar-todos` requiere confirmación interactiva.

### Plantillas

- `/crear-plantilla`, `/plantillas`, `/editar-plantilla`, `/eliminar-plantilla`, `/publicar-plantilla`
- Categorías disponibles: bienvenida, anuncios, sorteos, metas, Media of the Week, Media del Mes, renovaciones, ascensos y descensos.

### Comunidad y gestión

- `/verificacion`: formulario privado; el Staff acepta o rechaza la solicitud en el canal configurado. Al aceptar se asigna el rol verificado y se notifica por mensaje privado.
- `/evidencias`: publica plataforma, enlace, descripción y archivo opcional en el canal configurado.
- `/postular`: formulario de postulación con botones de aprobación y rechazo.
- `/recompensas listar`, `/recompensas crear`, `/recompensas eliminar`, `/canjear`
- `/historial-acciones`

## Alojamiento

En un servidor Linux, instala Node.js 20+, carga el proyecto y sus dependencias, configura `.env`, registra los comandos una vez con `npm run deploy` y mantén `npm start` activo con el supervisor de procesos de tu plataforma (por ejemplo, systemd o PM2). Configura copias de seguridad de `data/eskmc.sqlite` y conserva `data/` en un volumen persistente si usas contenedores.

No se incluye ni se necesita ninguna credencial en el código fuente.
q