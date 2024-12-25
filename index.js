import terminalSize from "term-size";
import ansiEscapes from "ansi-escapes";
import readline from "readline";
import hgl from "gl";
import chalk from "chalk";
import * as twgl from "twgl.js";

// Initialize readline and stdin
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Hide cursor and clear screen
process.stdout.write(ansiEscapes.cursorHide);
process.stdout.write(ansiEscapes.eraseScreen);
process.stdout.write('\x1b[?1049h');

// Set raw mode to capture each keystroke
rl.input.setRawMode(true);

const Performance = {
    now() {
        return Date.now() / 1000;
    }
}

let performance = 0;

// Listen for keypress events
rl.input.on("data", (key) => {
    // key is a buffer, so convert it to a string
    const keyStr = key.toString();

    if (keyStr === /*esc*/ '\u001b') {
        console.log('HERE');
        // Cleanup: Show cursor and exit alternate screen
        process.stdout.write(ansiEscapes.cursorShow);
        process.stdout.write('\x1b[?1049l');
        console.log('rows', rows, 'columns', columns);
        console.log('~fps', 1 / performance);
        process.exit();
    }
});

const {columns, rows} = terminalSize();

const aspectRatio = columns / rows;
const screenBuffer = Array(columns).fill('.').map(() => Array(rows).fill(' '));

const gl = hgl(columns, rows, {preserveDrawingBuffer: true});
const pixels = new Uint8Array(columns * rows * 4);

const shader = `
// Version 100
precision highp float;

uniform vec3 iResolution;
uniform float iTime;
uniform vec2 iMouse;

uniform float aspectRatio;

vec3 palette( float t ) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263,0.416,0.557);

    return a + b*cos( 6.28318*(c*t+d) );
}

vec4 roundVec4(vec4 x) {
    return vec4(floor(x + 0.5));
}


#define LOW_PERF      0   // set to 1 for better performances

// spacing controls
#define spacing       7.  // columns repetition spacing
#define light_spacing 2.  // light   repetition spacing (try 1. for a psychedelic effect!)

#define attenuation  22.  // light   attenuation

// speed controls
#define GLOBAL_SPEED  .7
#define camera_speed  1.
#define lights_speed 30.
#define columns_speed 4.

#if LOW_PERF
    #define iterations 30.
    #define max_dist   30.
#else
    #define iterations 50.
    #define max_dist   80.
#endif

#define epsilon 0.005
#define iTime (iTime*GLOBAL_SPEED)

#define rot(a) mat2(cos(a), -sin(a), sin(a), cos(a))
#define rep(p, r) (mod(p+r/2., r)-r/2.)
#define torus(p) (length( vec2(length(p.xz)-.6,p.y) ) - .06)

float hash12(vec2 p) {
vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 getLight(vec3 p, vec3 color) {
    return max(vec3(0.), color / (1. + pow(abs(torus(p) * attenuation), 1.3)) - .001);
}

vec3 geo(vec3 po, inout float d, inout vec2 f) {
    // shape repetition
    float r = hash12(floor(po.yz/spacing+vec2(.5)))-.5;
    vec3  p = rep(po + vec3(iTime*r*columns_speed, 0., 0.), vec3(.5, spacing, spacing));
    p.xy   *= rot(1.57);
    d       = min(d, torus(p));
    
    // light repetition
    f       = floor(po.yz/(spacing*light_spacing)-vec2(.5));
    r       = hash12(f)-.5;
    if (r > -.45) p = rep(po + vec3(iTime*lights_speed*r, 0., 0.), spacing*light_spacing*vec3(r+.54, 1., 1.));
    else p  = rep(po + vec3(iTime*lights_speed*.5*(1.+r*0.003*hash12(floor(po.yz*spacing))), 0., 0.), spacing*light_spacing);
    p.xy   *= rot(1.57);
    f       = (cos(f.xy)*.5+.5)*.4;
    
    return p;
}

vec4 map(vec3 p) {
    float d = 1e6;
    vec3 po, col = vec3(0.);
    vec2 f;
    
    po = geo(p, d, f);
    col  += getLight(po, vec3(1., f));        // x
    
    p.z  += spacing/2.;
    p.xy *= rot(1.57);
    po    = geo(p, d, f);
    col  += getLight(po, vec3(f.x, .5, f.y)); // y
    
    p.xy += spacing/2.;
    p.xz *= rot(1.57);
    po    = geo(p, d, f);
    col  += getLight(po, vec3(f, 1.));        // z
     
    return vec4(col, d);
}

vec3 getOrigin(float t) {
    t = (t+35.)*-.05*camera_speed;
    float rad = mix(50., 80., cos(t*1.24)*.5+.5);
    return vec3(rad*sin(t*.97), rad*cos(t*1.11), rad*sin(t*1.27));
}

void initRayOriginAndDirection(vec2 uv, inout vec3 ro, inout vec3 rd) {
    vec2 m = iMouse.xy/iResolution.xy*2.-1.; 
    
    ro = getOrigin(iTime+m.x*10.);
    
    vec3 f = normalize(getOrigin(iTime+m.x*10.+.5) - ro);    
    vec3 r = normalize(cross(normalize(ro), f));
    rd = normalize(f + uv.x*r + uv.y*cross(f, r));
}

void mainImage(out vec4 O, in vec2 F) {
    vec2 uv = (2.*F - iResolution.xy)/iResolution.y;
    vec3 p, ro, rd, col;
    
    initRayOriginAndDirection(uv, ro, rd);
    
    float t = 2.;
    for (float i = 0.; i < iterations; i++) {
        p = ro + t*rd;
        
        vec4 res = map(p);
        col += res.rgb;
        t += abs(res.w);

        if (abs(res.w) < epsilon) t += epsilon;
        
        if (col.r >= 1. && col.g >= 1. && col.b >= 1.) break;
        if (t > max_dist) break;
    }
            
    col = pow(col, vec3(.45));
    O = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, vec2(gl_FragCoord.x / 2. + iResolution.x / 4., gl_FragCoord.y));
}
`;

const programInfo = twgl.createProgramInfo(gl, [`
            precision highp float;
            attribute vec2 position;
            
            uniform vec3 iResolution;
            uniform float iTime;
                        
            varying vec2 fragCoord;
            
            void main() {
                // gl_Position = vec4(position.x, position.y, 0, 1);
                // fragCoord = position.xy;
                // Above technically works, but the issue is that the pixels are not square, but a rectangle with aspectRatio 1:2. Here's the fix:
                gl_Position = vec4(position.x, position.y, 0, 1);
                fragCoord = position.xy;
            }
        `, shader]);

const bufferInfo = twgl.createBufferInfoFromArrays(gl, {
    position: {
        numComponents: 2,
        data: [
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ],
    },
});

gl.useProgram(programInfo.program);
twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);

function render(time) {
    twgl.setUniforms(programInfo, {
        iTime: time,
        iResolution: [columns, rows, 1],
        iMouse: [0, 0],
        points: [4,1,5,7,34,16], // scaled to 0..1
        aspectRatio,
    });

    twgl.drawBufferInfo(gl, bufferInfo, gl.TRIANGLE_STRIP);

    gl.readPixels(0, 0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const out = [];
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            const i = (x + y * columns) * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];
            const char = a > 0 ? '█' : ' ';
            out.push(chalk.rgb(r, g, b)(char));
        }
        // out.push('\n');  // Add a newline character at the end of each row
    }

    process.stdout.write(ansiEscapes.cursorTo(0, 0) + out.join(''));
}

let time = 0;
while (true) {
    const p = Performance.now();
    await render(time);

    await new Promise((resolve) => setTimeout(resolve, 10));

    performance = Performance.now() - p;
    time += performance;
}
