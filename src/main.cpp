#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "SPIFFS.h"
#include <FS.h>
#include <math.h>
#include <esp_system.h>
#include <SPI.h>
#include <SD.h>
#include <vector>
#include <Preferences.h>
static Preferences prefs;

// --- SD pin config (edit CS if needed) ---
#define SD_SCK   18
#define SD_MISO  19
#define SD_MOSI  23
#define SD_CS     5


const char* AP_SSID     = "ESP32-Web";
const char* AP_PASSWORD = "esp32web";
WebServer server(80);

static const char* META_PATH = "/meta.json";

struct SampleRow { float t, throttle, v, i, kg, p, eff; };
static std::vector<SampleRow> g_samples;  // cleared at each run

static bool   g_last_log_saved = false;
static String g_last_log_path  = "";
static float  g_last_max_current = 0.0f;  // A
static float  g_last_esc_reco    = 0.0f;  // A (1.5 * max current)
static volatile bool  g_test_aborted = false;


static String analysisDefaultCfg() {
  return "{\"graphs\":["
         "{\"x\":\"TIME\",\"y\":\"VOLTAGE\"},"
         "{\"x\":\"TIME\",\"y\":\"POWER\"},"
         "{\"x\":\"THROTTLE\",\"y\":\"KG\"},"
         "{\"x\":\"TIME\",\"y\":\"EFFICIENCY\"}"
         "]}";
}

static String analysisLoadCfg() {
  // Avoid NOT_FOUND logs by checking first
  if (!prefs.isKey("acfg")) return analysisDefaultCfg();
  String s = prefs.getString("acfg");    // only called if key exists
  if (s.length() == 0) s = analysisDefaultCfg();
  return s;
}

static bool analysisSaveCfg(const String& s) {
  if (s.indexOf("\"graphs\"") < 0) return false;
  prefs.putString("acfg", s);
  return true;
}


// Basic sanitization for /logs paths
static bool isValidLogPath(const String& p){
  if (!p.startsWith("/logs/")) return false;
  if (p.indexOf("..") >= 0)    return false;
  return true;
}


struct ProjectMeta {
  String brand, motor, kv, prop, desc;
};
static ProjectMeta g_meta;  // kept in RAM for fast access

// (Very small) JSON helpers for the simple flat object we store
static String jsonEscape(String s) {
  s.replace("\\", "\\\\");
  s.replace("\"", "\\\"");
  s.replace("\r", "");
  s.replace("\n", "\\n");
  return s;
}
static String jsonUnescape(String s) {
  s.replace("\\n", "\n");
  s.replace("\\\"", "\"");
  s.replace("\\\\", "\\");
  return s;
}
static String jsonGet(const String& doc, const char* key) {
  String pat = String("\"") + key + "\":\"";
  int i = doc.indexOf(pat);
  if (i < 0) return "";
  i += pat.length();
  int j = i;
  while (j < (int)doc.length()) {
    char c = doc[j];
    if (c == '"' && doc[j-1] != '\\') break;
    j++;
  }
  if (j <= i) return "";
  return jsonUnescape(doc.substring(i, j));
}
static void metaLoadFromFS() {
  g_meta = ProjectMeta{};
  if (!SPIFFS.exists(META_PATH)) return;
  File f = SPIFFS.open(META_PATH, "r");
  if (!f) return;
  String doc = f.readString();
  f.close();
  g_meta.brand = jsonGet(doc, "brand");
  g_meta.motor = jsonGet(doc, "motor");
  g_meta.kv    = jsonGet(doc, "kv");
  g_meta.prop  = jsonGet(doc, "prop");
  g_meta.desc  = jsonGet(doc, "desc");
}
static bool metaSaveToFS(const ProjectMeta& m) {
  String out; out.reserve(256);
  out += "{\"brand\":\""; out += jsonEscape(m.brand);
  out += "\",\"motor\":\""; out += jsonEscape(m.motor);
  out += "\",\"kv\":\"";    out += jsonEscape(m.kv);
  out += "\",\"prop\":\"";  out += jsonEscape(m.prop);
  out += "\",\"desc\":\"";  out += jsonEscape(m.desc);
  out += "\"}";
  File f = SPIFFS.open(META_PATH, "w");
  if (!f) return false;
  f.print(out); f.close();
  return true;
}

// ---- SD card state ----
static SPIClass sdSPI(VSPI);
static bool g_sd_ok = false;

// Make /logs directory once
static void ensureLogsDir() {
  if (g_sd_ok && !SD.exists("/logs")) SD.mkdir("/logs");
}

// Slugify meta for filename
static String slug(String s) {
  String o; o.reserve(s.length());
  for (char c : s) {
    if (c>='A'&&c<='Z') c = c - 'A' + 'a';
    if ((c>='a'&&c<='z')||(c>='0'&&c<='9')) o += c;
    else if (c==' '||c=='-'||c=='_') o += '-';
  }
  String r; r.reserve(o.length());
  bool dash=false;
  for (char c: o){ if (c=='-'){ if(!dash){ r+='-'; dash=true; } } else { r+=c; dash=false; } }
  while (r.length() && r[0]=='-') r.remove(0,1);
  while (r.length() && r[r.length()-1]=='-') r.remove(r.length()-1);
  return r;
}
static String buildLogPath() {
  String name;
  if (g_meta.brand.length()) name += slug(g_meta.brand) + "_";
  if (g_meta.motor.length()) name += slug(g_meta.motor) + "_";
  if (g_meta.kv.length())    name += slug(g_meta.kv)    + "_";
  if (g_meta.prop.length())  name += slug(g_meta.prop)  + "_";
  name += String(millis()); // unique without RTC
  if (name.length() == 0) name = "test_" + String(millis());
  return String("/logs/") + name + ".csv";
}

// ---------- static files ----------
String getContentType(const String& p){
  if(p.endsWith(".html")||p.endsWith(".htm"))return "text/html";
  if(p.endsWith(".css")) return "text/css";
  if(p.endsWith(".js"))  return "application/javascript";
  if(p.endsWith(".json"))return "application/json";
  if(p.endsWith(".png")) return "image/png";
  if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return "image/jpeg";
  if(p.endsWith(".svg")) return "image/svg+xml";
  if(p.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}
bool handleFileRead(String path){
  if(path.endsWith("/")) path += "index.html";
  if(!SPIFFS.exists(path)) return false;
  File f = SPIFFS.open(path, "r");
  server.streamFile(f, getContentType(path));
  f.close(); return true;
}
void handleNotFound(){
  if(!handleFileRead(server.uri())) server.send(404,"text/plain","404: Not found");
}

// ---------- simulated sensors ----------
static inline float randf(float span){ return (float)esp_random()/(float)UINT32_MAX*span; }
float readVoltage(){ float t=millis()/1000.0f; return 12.1f+0.15f*sinf(t/6.0f)+(randf(1.0f)-0.5f)*0.05f; }
float readCurrent(){ float t=millis()/1000.0f; float v=5.0f+2.0f*sinf(t/4.0f)+(randf(1.0f)-0.5f)*0.6f; return v<0?0:v; }
float readLoadKg(){ float t=millis()/1000.0f; float v=0.9f+0.3f*sinf(t/5.0f)+(randf(1.0f)-0.5f)*0.05f; return v<0?0:v; }

// ---------- throttle / test state ----------
static bool g_is_armed = false;
void set_throttle(int pct){            // dummy
  pct = constrain(pct, 0, 100);
  g_is_armed = (pct > 0);
  Serial.printf("motor armed at %d percentage\n", pct);
}

// ---------- thrust test task ----------
struct TestParams { int target; float step_s; float ramp_s; };
static volatile bool  g_test_running=false, g_test_done=false;
static volatile int   g_test_samples=0, g_test_target=0;
static volatile float g_test_step_s=0.5f, g_test_ramp_s=10.0f;
static TaskHandle_t   g_test_task=nullptr;

void thrust_test_task(void* pv) {
  // Params were heap-allocated when the task was created
  TestParams p = *(TestParams*)pv;
  delete (TestParams*)pv;

  // --- announce + init state ---
  g_test_running   = true;
  g_test_done      = false;
  g_test_target    = p.target;
  g_test_step_s    = p.step_s;
  g_test_ramp_s    = p.ramp_s;

  // reset last-run report & RAM buffer
  g_last_log_saved   = false;
  g_last_log_path    = "";
  g_last_max_current = 0.0f;
  g_last_esc_reco    = 0.0f;
  g_samples.clear();
  g_samples.reserve(1024);

  // --- print meta once ---
  Serial.println("\n=== PROJECT META ===");
  Serial.printf("MOTOR BRAND: %s\n", g_meta.brand.length()? g_meta.brand.c_str() : "—");
  Serial.printf("MOTOR      : %s\n", g_meta.motor.length()? g_meta.motor.c_str() : "—");
  Serial.printf("KV         : %s\n", g_meta.kv.length()?    g_meta.kv.c_str()    : "—");
  Serial.printf("PROPELLER  : %s\n", g_meta.prop.length()?  g_meta.prop.c_str()  : "—");
  Serial.println("DESCRIPTION:");
  Serial.println(g_meta.desc.length()? g_meta.desc : "—");

  Serial.printf("\n=== THRUST TEST START === (target=%d%%, log step=%.2fs, ramp=%.1fs)\n",
                p.target, p.step_s, p.ramp_s);
  Serial.println("time(s)\tthrottle(%)\tvoltage(V)\tcurrent(A)\tload(kg)");

  // --- ramp setup ---
  const int   tick_ms = 50;
  const int   ramp_ms = (int)roundf(p.ramp_s * 1000.0f);
  const float inc_per_tick = (p.target <= 0 || ramp_ms <= 0)
                               ? 0.0f
                               : (float)p.target / ((float)ramp_ms / tick_ms);

  set_throttle(0);
  uint32_t t_start     = millis();
  uint32_t next_log_ms = t_start;
  float    cur         = 0.0f;   // commanded throttle [0..target]

  // --- one place to capture a sample ---
  auto push_sample = [&](uint32_t now_ms) {
    float tsec = (now_ms - t_start) / 1000.0f;
    float v    = readVoltage();
    float i    = readCurrent();
    float kg   = readLoadKg();
    float pwr  = v * i;                           // W
    float eff  = (pwr > 1e-6f) ? (kg / pwr) : 0;  // kg/W (avoid div0)

    if (i > g_last_max_current) g_last_max_current = i;

    // Keep the existing serial table for quick visibility
    Serial.printf("%.2f\t%.0f\t\t%.2f\t\t%.2f\t\t%.2f\n", tsec, cur, v, i, kg);

    g_samples.push_back(SampleRow{ tsec, cur, v, i, kg, pwr, eff });
    g_test_samples++;
  };

  // initial sample
  push_sample(t_start);

  // --- ramp 0 -> target (stop if aborted) ---
  while (g_test_running && cur < (float)p.target - 0.01f) {
    cur += inc_per_tick;
    if (cur > p.target) cur = (float)p.target;
    set_throttle((int)roundf(cur));

    uint32_t now = millis();
    if (now >= next_log_ms) {
      push_sample(now);
      next_log_ms += (uint32_t)(g_test_step_s * 1000.0f);
    }
    vTaskDelay(pdMS_TO_TICKS(tick_ms));
  }

  // Final scheduled sample if we crossed a boundary
  uint32_t now = millis();
  if (now + 1 >= next_log_ms) push_sample(now);

  // Always disarm at the end of the task
  set_throttle(0);
  Serial.println("=== THRUST TEST END ===");

  // If user pressed Stop during the run, do not save anything
  if (g_test_aborted) {
    Serial.println("=== THRUST TEST ABORTED — NO DATA SAVED ===");
    g_last_log_saved = false;
    g_last_log_path  = "";
  } else {
    g_test_aborted   = false;
    // Compute recommendation numbers
    g_last_esc_reco = g_last_max_current * 1.5f;

    // Write ONE CSV after test completes
    if (g_sd_ok) {
      ensureLogsDir();
      String path = buildLogPath();
      File log = SD.open(path, FILE_WRITE);
      if (log) {
        // Meta header
        log.print("MOTOR BRAND:,"); log.println(g_meta.brand);
        log.print("MOTOR:,");        log.println(g_meta.motor);
        log.print("KV:,");           log.println(g_meta.kv);
        log.print("PROPELLER:,");    log.println(g_meta.prop);
        log.println("DESCRIPTION:");
        if (g_meta.desc.length()) {
          int s = 0;
          while (s < (int)g_meta.desc.length()) {
            int nl = g_meta.desc.indexOf('\n', s);
            if (nl < 0) nl = g_meta.desc.length();
            log.println(g_meta.desc.substring(s, nl));
            s = nl + 1;
          }
        } else {
          log.println("—");
        }
        // Peak/ESC
        log.print("PEAK_CURRENT_A:,");    log.println(String(g_last_max_current, 3));
        log.print("RECOMMENDED_ESC_A:,"); log.println(String(g_last_esc_reco,    3));
        log.println();

        // Table header (includes power & efficiency)
        log.println("TIME,THROTTLE,VOLTAGE,CURRENT,KG,POWER,EFFICIENCY");

        // Rows
        for (const auto& r : g_samples) {
          log.printf("%.3f,%.0f,%.3f,%.3f,%.3f,%.3f,%.6f\n",
                     r.t, r.throttle, r.v, r.i, r.kg, r.p, r.eff);
        }
        log.flush();
        log.close();

        g_last_log_saved = true;
        g_last_log_path  = path;
        Serial.printf("SD: saved %s (ESC≈%.1fA, Imax=%.2fA)\n",
                      path.c_str(), g_last_esc_reco, g_last_max_current);
      } else {
        Serial.println("SD: failed to open log file");
        g_last_log_saved = false;
        g_last_log_path  = "";
      }
    } else {
      Serial.println("SD: not available; skipping CSV write");
      g_last_log_saved = false;
      g_last_log_path  = "";
    }
  }

  // Free RAM and finish
  g_samples.clear();
  g_samples.shrink_to_fit();

  g_test_running = false;
  g_test_done    = true;
  g_test_task    = nullptr;
  vTaskDelete(nullptr);
}




// ---------- setup & routes ----------
void setup(){
  Serial.begin(115200); delay(200);
  prefs.begin("bench", false);
  SPIFFS.begin(true);
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  g_sd_ok = SD.begin(SD_CS, sdSPI);
  if (g_sd_ok) { ensureLogsDir(); Serial.println("SD: mounted OK"); }
  else         { Serial.println("SD: mount FAILED"); }

  metaLoadFromFS();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.printf("\nAP SSID: %s\nAP IP  : %s\n",
                AP_SSID, WiFi.softAPIP().toString().c_str());

  // live JSON
  server.on("/api/live", HTTP_GET, [](){
    uint32_t ts = millis()/1000;
    String out; out.reserve(96);
    out += "{\"ts\":"; out += ts;
    out += ",\"v\":";  out += String(readVoltage(),3);
    out += ",\"i\":";  out += String(readCurrent(),3);
    out += ",\"kg\":"; out += String(readLoadKg(),3);
    out += "}";
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",out);
  });

  // manual throttle (blocked during test)
  server.on("/api/set_throttle", HTTP_POST, [](){
    if(!server.hasArg("pct")){ server.send(400,"application/json","{\"ok\":false,\"err\":\"missing pct\"}"); return; }
    if(g_test_running){ server.send(409,"application/json","{\"ok\":false,\"err\":\"test_running\"}"); return; }
    int pct = constrain(server.arg("pct").toInt(),0,100);
    set_throttle(pct);
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",String("{\"ok\":true,\"pct\":")+pct+"}");
  });
  g_test_aborted = false;

  // start thrust test (adds ramp_s)
  server.on("/api/start_thrust_test", HTTP_POST, [](){
    if(!server.hasArg("pct")){ server.send(400,"application/json","{\"ok\":false,\"err\":\"missing pct\"}"); return; }
    int   target = constrain(server.arg("pct").toInt(), 0, 100);
    float step_s = server.hasArg("step_s") ? server.arg("step_s").toFloat() :
                   server.hasArg("step")   ? server.arg("step").toFloat()   : 0.5f;
    if(!(step_s>0)) step_s=0.5f; step_s = constrain(step_s, 0.1f, 5.0f);

    float ramp_s = server.hasArg("ramp_s") ? server.arg("ramp_s").toFloat() : 10.0f; // default slow ramp
    ramp_s = constrain(ramp_s, 0.5f, 120.0f);

    // ensure safe start: auto-disarm if needed
    if(g_is_armed) set_throttle(0);
    if(g_test_running){ server.send(409,"application/json","{\"ok\":false,\"err\":\"busy\"}"); return; }
    g_test_aborted = false;
    g_test_done = false;

    TestParams* p = new TestParams{ target, step_s, ramp_s };
    xTaskCreatePinnedToCore(thrust_test_task, "thrust_test", 4096, p, 1, &g_test_task, 1);

    String out; out.reserve(96);
    out += "{\"ok\":true,\"started\":true,\"target\":"; out += target;
    out += ",\"step_s\":"; out += String(step_s,2);
    out += ",\"ramp_s\":"; out += String(ramp_s,1);
    out += "}";
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",out);
  });

  server.on("/api/stop_thrust_test", HTTP_POST, []() {
    if (!g_test_running) {
      server.send(409, "application/json", "{\"ok\":false,\"err\":\"no_test\"}");
      return;
    }
    g_test_aborted = true;     // mark aborted
    g_test_running = false;    // tell task loop to exit
    set_throttle(0);           // motor off right away
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", "{\"ok\":true,\"stopping\":true}");
  });

  // status
  server.on("/api/test_status", HTTP_GET, []() {
    String out; out.reserve(192);
    out += "{\"running\":"; out += (g_test_running ? "true" : "false");
    out += ",\"done\":";    out += (g_test_done    ? "true" : "false");
    out += ",\"samples\":"; out += g_test_samples;
    out += ",\"target\":";  out += g_test_target;
    out += ",\"step_s\":";  out += String(g_test_step_s, 2);
    out += ",\"ramp_s\":";  out += String(g_test_ramp_s, 1);
    out += ",\"sd\":";      out += (g_sd_ok ? "true" : "false");
    out += ",\"saved\":";   out += (g_last_log_saved ? "true" : "false");
    out += ",\"logfile\":\""; out += jsonEscape(g_last_log_path); out += "\"";
    out += ",\"i_max\":";   out += String(g_last_max_current, 3);
    out += ",\"esc_reco\":";out += String(g_last_esc_reco, 3);
    out += ",\"aborted\":"; out += (g_test_aborted ? "true" : "false");
    out += "}";
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", out);
  });

  // List logs on SD: GET /api/logs  -> { sd:bool, files:[{path,name,size}] }
  server.on("/api/logs", HTTP_GET, [](){
    String out; out.reserve(512);
    out += "{\"sd\":"; out += (g_sd_ok ? "true" : "false");
    out += ",\"files\":[";
    if (g_sd_ok) {
      File dir = SD.open("/logs");
      bool first = true;
      if (dir) {
        while (true) {
          File f = dir.openNextFile();
          if (!f) break;
          if (!f.isDirectory()) {
            // Get name safely (some cores return full path, some only the filename)
            String name = String(f.name());
            int slash = name.lastIndexOf('/');
            if (slash >= 0) name = name.substring(slash + 1);  // strip any path
            // Build the path we will serve from /api/log_download
            String path = String("/logs/") + name;

            if (!first) out += ",";
            first = false;
            out += "{\"path\":\""; out += jsonEscape(path);
            out += "\",\"name\":\""; out += jsonEscape(name);
            out += "\",\"size\":"; out += (unsigned long)f.size();
            out += "}";
          }
          f.close();
        }
        dir.close();
      }
    }
    out += "]}";
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",out);
  });


  // Download CSV: GET /api/log_download?file=/logs/xxx.csv
  server.on("/api/log_download", HTTP_GET, [](){
    if (!server.hasArg("file")) { server.send(400,"text/plain","missing file"); return; }
    String path = server.arg("file");
    if (!g_sd_ok || !isValidLogPath(path) || !SD.exists(path)) {
      server.send(404,"text/plain","not found"); return;
    }
    File f = SD.open(path, FILE_READ);
    if (!f) { server.send(500,"text/plain","open fail"); return; }
    int slash = path.lastIndexOf('/');
    String fname = (slash>=0)? path.substring(slash+1) : path;
    server.sendHeader("Content-Type","text/csv");
    server.sendHeader("Content-Disposition", "attachment; filename=\""+fname+"\"");
    server.streamFile(f, "text/csv");
    f.close();
  });

  // Analysis prefs
  // GET -> returns JSON layout; POST -> save layout
  server.on("/api/analysis_pref", HTTP_GET, [](){
    server.sendHeader("Cache-Control","no-store");
    server.send(200,"application/json",analysisLoadCfg());
  });
  // Analysis prefs
  server.on("/api/analysis_pref", HTTP_POST, [](){
    // Accept either a JSON blob in "cfg", or 8 fields g0x,g0y..g3x,g3y
    String cfg = server.hasArg("cfg") ? server.arg("cfg") : "";
    if (cfg.length() == 0) {
      // Accept keys like "g0x", "g0y", ..., "g3x", "g3y"
      auto safe = [&](const String& key) -> String {
        String v = server.hasArg(key) ? server.arg(key) : "";
        v.trim();
        v.toUpperCase();
        // allow only known column tokens
        const char* cols[] = {"TIME","THROTTLE","VOLTAGE","CURRENT","KG","POWER","EFFICIENCY"};
        bool ok = false;
        for (size_t j=0; j<sizeof(cols)/sizeof(cols[0]); ++j) {
          if (v == cols[j]) { ok = true; break; }
        }
        return ok ? v : String("TIME");
      };

      cfg.reserve(240);
      cfg = "{\"graphs\":[";
      for (int i = 0; i < 4; ++i) {
        if (i) cfg += ",";
        String kx = "g" + String(i) + "x";
        String ky = "g" + String(i) + "y";
        String vx = safe(kx);
        String vy = safe(ky);
        cfg += "{\"x\":\"" + jsonEscape(vx) + "\",\"y\":\"" + jsonEscape(vy) + "\"}";
      }
      cfg += "]}";
    }

    bool ok = analysisSaveCfg(cfg);
    if (!ok) { server.send(400, "application/json", "{\"ok\":false}"); return; }
    server.sendHeader("Cache-Control","no-store");
    server.send(200, "application/json", "{\"ok\":true}");
  });


    // GET meta
    // GET /api/meta  -> returns saved meta, also refreshes g_meta
    server.on("/api/meta", HTTP_GET, []() {
      metaLoadFromFS();
      server.sendHeader("Cache-Control","no-store");
      if (SPIFFS.exists(META_PATH)) {
        File f = SPIFFS.open(META_PATH, "r");
        if (f) { server.streamFile(f, "application/json"); f.close(); return; }
      }
      server.send(200, "application/json",
        "{\"brand\":\"\",\"motor\":\"\",\"kv\":\"\",\"prop\":\"\",\"desc\":\"\"}");
    });

    // POST /api/meta  -> save and update g_meta
    server.on("/api/meta", HTTP_POST, []() {
      ProjectMeta m;
      m.brand = server.hasArg("brand") ? server.arg("brand") : "";
      m.motor = server.hasArg("motor") ? server.arg("motor") : "";
      m.kv    = server.hasArg("kv")    ? server.arg("kv")    : "";
      m.prop  = server.hasArg("prop")  ? server.arg("prop")  : "";
      m.desc  = server.hasArg("desc")  ? server.arg("desc")  : "";

      m.brand.trim(); m.motor.trim(); m.kv.trim(); m.prop.trim();
      if (m.desc.length() > 1024) m.desc = m.desc.substring(0,1024);

      if (!metaSaveToFS(m)) {
        server.send(500, "application/json", "{\"ok\":false,\"err\":\"fs_write\"}");
        return;
      }
      g_meta = m;  // keep RAM copy fresh

      // Echo back what we saved (handy for the UI)
      String out; out.reserve(256);
      out += "{\"ok\":true,\"saved\":{";
      out += "\"brand\":\""+jsonEscape(m.brand)+"\",";
      out += "\"motor\":\""+jsonEscape(m.motor)+"\",";
      out += "\"kv\":\""+jsonEscape(m.kv)+"\",";
      out += "\"prop\":\""+jsonEscape(m.prop)+"\",";
      out += "\"desc\":\""+jsonEscape(m.desc)+"\"";
      out += "}}";
      server.sendHeader("Cache-Control","no-store");
      server.send(200, "application/json", out);
    });

  // site
  server.on("/", HTTP_GET, [](){ if(!handleFileRead("/index.html")) server.send(500,"text/plain","index.html not found"); });
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("HTTP server started.");
}

void loop(){ server.handleClient(); }
