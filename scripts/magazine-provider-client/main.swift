// 소란소란 매거진 전용 provider client (macOS 네이티브 · 단발 실행).
//
// 하는 일은 하나다 — 로그인 키체인의 고정 항목 하나로 api.openai.com 의 정해진 네 요청만 보낸다.
//   request  stdin JSON 한 건 → stdout JSON 한 건. 키는 UI 없이만 읽는다(예약 실행용 · 창이 뜨면 안 된다).
//   status   비대화형 점검 — 항목이 있는지 · UI 없이 읽히는지. 네트워크 0 · 유료 호출 0.
//   grant    사람이 터미널에서 직접 부르는 최초 동의 — macOS 가 묻는 창에서 "항상 허용"을 누른다. 네트워크 0.
//   version  빌드 · 계약 값. 키체인 · 네트워크 0.
//
// 🔴 키 원문과 Authorization 헤더는 stdout · stderr · 파일 · 환경 어디에도 쓰지 않는다. 이 프로세스 밖으로 나가는 곳은 TLS 요청 헤더 하나다.
// 🔴 service · account · host · path · method 는 상수다. 인자 · 환경 · 입력으로 바꿀 수 없다.
// 🔴 순서: 입력 검증 → 키 읽기 → 전송. 키를 못 읽으면 전송하지 않는다(sent:false). 전송을 시작한 뒤의 실패는 전부 sent:true(불명)다.
// OFFLINE_TEST 빌드는 키체인과 네트워크를 가짜로 바꾼 검사 전용이다 — 운영 빌드에는 그 코드가 컴파일되지 않는다.

import Foundation
import Security
#if OFFLINE_TEST
import CryptoKit
#endif

let clientVersion = "1"
let protocolVersion = 1
let keychainService = "soransoran-magazine-openai"
let keychainAccount = "magazine-pilot"
let apiHost = "api.openai.com"
let textModels: Set<String> = ["gpt-6-luna", "gpt-6.1-terra"]
let imageModel = "gpt-image-2.5-flare"
let imageSize = "1536x864"
let imageQuality = "medium"
let maxManuscriptTokens = 32_000
let maxRepairTokens = 4_000
let maxStdinBytes = 1 << 20
let maxResponseBytes = 96 << 20
let timeoutCapMs: [String: Int] = ["submit": 120_000, "retrieve": 60_000, "remove": 60_000, "image": 300_000]

#if OFFLINE_TEST
let buildKind = "OFFLINE_TEST"
#else
let buildKind = "PRODUCTION"
#endif

// ── 출력 ─────────────────────────────────────────────────────

func emit(_ object: [String: Any], code: Int32) -> Never {
    var out = object
    out["v"] = protocolVersion
    out["build"] = buildKind
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data("{\"v\":1,\"ok\":false,\"sent\":true,\"code\":\"CLIENT_OUTPUT\"}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(code)
}

/// 전송 전 실패 — 서버에 아무것도 가지 않았다
func notSent(_ code: String, detail: Int? = nil) -> Never {
    var o: [String: Any] = ["ok": false, "sent": false, "code": code]
    if let d = detail { o["detail"] = d }
    emit(o, code: 10)
}

/// 전송을 시작한 뒤의 실패 — 서버가 받았는지 모른다
func ambiguous(_ code: String, detail: Int? = nil) -> Never {
    var o: [String: Any] = ["ok": false, "sent": true, "code": code]
    if let d = detail { o["detail"] = d }
    emit(o, code: 11)
}

// ── JSON 값 판독 ─────────────────────────────────────────────

func isBool(_ v: Any?) -> Bool {
    guard let v = v else { return false }
    return CFGetTypeID(v as CFTypeRef) == CFBooleanGetTypeID()
}
func boolValue(_ v: Any?) -> Bool? { isBool(v) ? (v as? Bool) : nil }
func intValue(_ v: Any?) -> Int? {
    guard let n = v as? NSNumber, !isBool(v) else { return nil }
    let d = n.doubleValue
    guard d.isFinite, d == d.rounded(), abs(d) < 9_007_199_254_740_992 else { return nil }
    return Int(d)
}
func object(_ text: String) -> [String: Any]? {
    guard let v = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: []) else { return nil }
    return v as? [String: Any]
}
func exactKeys(_ o: [String: Any], _ keys: Set<String>) -> Bool { Set(o.keys) == keys }

// ── 요청 계약 ────────────────────────────────────────────────

struct Call {
    let method: String
    let path: String
    let body: Data?
    let timeout: TimeInterval
}

func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

func validTextBody(_ text: String) -> Bool {
    guard let b = object(text),
          exactKeys(b, ["model", "instructions", "input", "text", "background", "store", "max_output_tokens"]),
          let model = b["model"] as? String, textModels.contains(model),
          b["instructions"] is String,
          let input = b["input"] as? [Any], input.count == 1,
          boolValue(b["background"]) == true, boolValue(b["store"]) == true,
          let tokens = intValue(b["max_output_tokens"]),
          let t = b["text"] as? [String: Any], exactKeys(t, ["format"]),
          let f = t["format"] as? [String: Any], exactKeys(f, ["type", "name", "schema", "strict"]),
          f["type"] as? String == "json_schema", boolValue(f["strict"]) == true, f["schema"] is [String: Any],
          let name = f["name"] as? String
    else { return false }
    let cap = name == "magazine_manuscript" ? maxManuscriptTokens : name == "magazine_repair" ? maxRepairTokens : 0
    return tokens >= 1 && tokens <= cap
}

func validImageBody(_ text: String) -> Bool {
    guard let b = object(text),
          exactKeys(b, ["model", "prompt", "size", "quality", "n"]),
          b["model"] as? String == imageModel,
          b["size"] as? String == imageSize,
          b["quality"] as? String == imageQuality,
          intValue(b["n"]) == 1,
          let prompt = b["prompt"] as? String, !prompt.isEmpty, prompt.utf8.count <= 16_000
    else { return false }
    return true
}

/// stdin 한 건 → 보낼 요청. 계약 밖이면 nil(전송 0 · 키 읽기 0)
func parseCall(_ input: Data) -> Call? {
    guard input.count <= maxStdinBytes,
          let text = String(data: input, encoding: .utf8),
          let p = object(text),
          intValue(p["v"]) == protocolVersion,
          let op = p["op"] as? String, let cap = timeoutCapMs[op],
          let ms = intValue(p["timeoutMs"]), ms >= 1_000, ms <= cap
    else { return nil }
    let timeout = TimeInterval(ms) / 1000
    switch op {
    case "submit", "image":
        guard exactKeys(p, ["v", "op", "timeoutMs", "body"]), let body = p["body"] as? String else { return nil }
        guard op == "submit" ? validTextBody(body) : validImageBody(body) else { return nil }
        return Call(method: "POST", path: op == "submit" ? "/v1/responses" : "/v1/images/generations", body: Data(body.utf8), timeout: timeout)
    case "retrieve", "remove":
        guard exactKeys(p, ["v", "op", "timeoutMs", "id"]), let id = p["id"] as? String,
              matches(id, "^resp_[A-Za-z0-9_-]{4,123}$") else { return nil }
        return Call(method: op == "retrieve" ? "GET" : "DELETE", path: "/v1/responses/\(id)", body: nil, timeout: timeout)
    default:
        return nil
    }
}

// ── 키 ───────────────────────────────────────────────────────

struct KeyError: Error {
    let code: String
    let osStatus: Int
}

/// 앞뒤 공백만 걷고, 헤더에 넣어도 되는 글자만 받는다(제어 문자 · 공백이 섞이면 거부)
func cleanKey(_ data: Data) -> String? {
    guard let raw = String(data: data, encoding: .utf8) else { return nil }
    let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard key.utf8.count >= 20, key.utf8.count <= 512, key.utf8.allSatisfy({ $0 >= 0x21 && $0 <= 0x7E }) else { return nil }
    return key
}

#if OFFLINE_TEST
let testKey = "sk-offline-test-" + String(repeating: "k", count: 32)
var testGranted = false

func loadKey(interactive: Bool) -> Result<String, KeyError> {
    let env = ProcessInfo.processInfo.environment
    if interactive {
        switch env["MPC_TEST_GRANT"] ?? "deny" {
        case "always": testGranted = true; return .success(testKey)
        case "once": return .success(testKey)
        default: return .failure(KeyError(code: "KEY_DENIED", osStatus: -128))
        }
    }
    if testGranted { return .success(testKey) }
    switch env["MPC_TEST_KEY"] ?? "notfound" {
    case "ok": return .success(testKey)
    case "consent": return .failure(KeyError(code: "KEY_CONSENT_REQUIRED", osStatus: -25308))
    case "malformed": return cleanKey(Data("short\n".utf8)).map { .success($0) } ?? .failure(KeyError(code: "KEY_MALFORMED", osStatus: 0))
    case "error": return .failure(KeyError(code: "KEY_ERROR", osStatus: -25291))
    default: return .failure(KeyError(code: "KEY_NOT_FOUND", osStatus: -25300))
    }
}

func itemPresence() -> String {
    switch ProcessInfo.processInfo.environment["MPC_TEST_KEY"] ?? "notfound" {
    case "notfound": return "ABSENT"
    case "error": return "UNKNOWN"
    default: return "PRESENT"
    }
}
#else
/// 창을 띄우지 않게 막는다 — 막혔는지 되읽어 확인하고, 확인되지 않으면 키체인을 건드리지 않는다
func forbidKeychainUI() -> Bool {
    guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { return false }
    var allowed: DarwinBoolean = true
    guard SecKeychainGetUserInteractionAllowed(&allowed) == errSecSuccess else { return false }
    return !allowed.boolValue
}

func baseQuery() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: keychainService,
     kSecAttrAccount as String: keychainAccount,
     kSecMatchLimit as String: kSecMatchLimitOne]
}

func loadKey(interactive: Bool) -> Result<String, KeyError> {
    if !interactive && !forbidKeychainUI() { return .failure(KeyError(code: "KEY_UI_GUARD_FAILED", osStatus: 0)) }
    var query = baseQuery()
    query[kSecReturnData as String] = true
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    switch status {
    case errSecSuccess:
        guard var data = out as? Data else { return .failure(KeyError(code: "KEY_ERROR", osStatus: 0)) }
        defer { data.resetBytes(in: 0..<data.count) }
        guard let key = cleanKey(data) else { return .failure(KeyError(code: "KEY_MALFORMED", osStatus: 0)) }
        return .success(key)
    case errSecItemNotFound:
        return .failure(KeyError(code: "KEY_NOT_FOUND", osStatus: Int(status)))
    case errSecInteractionNotAllowed, errSecAuthFailed:
        // UI 를 막은 채로는 이 둘이 "동의가 아직 없다(또는 키체인이 잠겼다)"는 뜻이다
        return .failure(KeyError(code: interactive ? "KEY_DENIED" : "KEY_CONSENT_REQUIRED", osStatus: Int(status)))
    case errSecUserCanceled:
        return .failure(KeyError(code: "KEY_DENIED", osStatus: Int(status)))
    default:
        return .failure(KeyError(code: "KEY_ERROR", osStatus: Int(status)))
    }
}

/// 항목이 있는지만 본다 — 속성만 읽으므로 비밀에 닿지 않는다
func itemPresence() -> String {
    guard forbidKeychainUI() else { return "UNKNOWN" }
    var query = baseQuery()
    query[kSecReturnAttributes as String] = true
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    return status == errSecSuccess ? "PRESENT" : status == errSecItemNotFound ? "ABSENT" : "UNKNOWN"
}
#endif

// ── 전송 ─────────────────────────────────────────────────────

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // 따라가지 않는다 — 3xx 응답을 그대로 돌려준다
    }
}

#if OFFLINE_TEST
/// 네트워크 대역 — 소켓을 열지 않는다. 받은 요청의 모양만 되돌려 준다(키는 맞았는지만 말한다)
final class StubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let env = ProcessInfo.processInfo.environment
        let url = request.url!
        if let log = env["MPC_TEST_NET_LOG"] {
            let line = Data("\(request.httpMethod ?? "?") \(url.absoluteString)\n".utf8)
            if let h = FileHandle(forWritingAtPath: log) { h.seekToEndOfFile(); h.write(line); h.closeFile() } else { FileManager.default.createFile(atPath: log, contents: line) }
        }
        let auth = request.value(forHTTPHeaderField: "Authorization")
        func reply(_ status: Int, _ json: [String: Any]) {
            let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]))
            client?.urlProtocolDidFinishLoading(self)
        }
        if url.host != apiHost { reply(200, ["followed": true, "authLeaked": auth != nil]); return }
        let mode = env["MPC_TEST_NET"] ?? "echo"
        if mode == "fail" { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
        if mode == "redirect" {
            let target = URL(string: "https://redirect.invalid/v1/responses")!
            let resp = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": target.absoluteString])!
            var next = request
            next.url = target
            client?.urlProtocol(self, wasRedirectedTo: next, redirectResponse: resp)
            // 거절되면 실제 HTTP 처럼 3xx 응답으로 끝난다. 따라갔다면 새 요청이 위의 "다른 host" 가지로 들어와 기록에 남는다
            client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if mode == "binary" {
            let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data([0xFF, 0xFE, 0x00, 0xC3]))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if mode.hasPrefix("status:"), let code = Int(mode.dropFirst(7)) { reply(code, ["error": ["code": "stub_\(code)", "message": "credential: " + testKey]]); return }
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 65_536)
            while true { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; body.append(buf, count: n) }
            stream.close()
        }
        reply(200, ["id": "resp_stub0001", "object": "response", "status": "queued", "store": true, "echo": [
            "method": request.httpMethod ?? "", "url": url.absoluteString, "authOk": auth == "Bearer \(testKey)",
            "contentType": request.value(forHTTPHeaderField: "Content-Type") ?? "", "hasCookie": request.value(forHTTPHeaderField: "Cookie") != nil,
            "bodyBytes": body.count, "bodySha256": SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined(),
        ]])
    }
}
#endif

func send(_ call: Call, key: String) -> Never {
    var comps = URLComponents()
    comps.scheme = "https"
    comps.host = apiHost
    comps.path = call.path
    guard let url = comps.url, url.host == apiHost, url.scheme == "https", url.port == nil, url.query == nil, url.path == call.path else { notSent("BAD_REQUEST") }

    let cfg = URLSessionConfiguration.ephemeral
    cfg.urlCache = nil
    cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    cfg.httpCookieStorage = nil
    cfg.httpShouldSetCookies = false
    cfg.httpCookieAcceptPolicy = .never
    cfg.urlCredentialStorage = nil
    cfg.waitsForConnectivity = false
    cfg.timeoutIntervalForRequest = call.timeout
    cfg.timeoutIntervalForResource = call.timeout
    cfg.tlsMinimumSupportedProtocolVersion = .TLSv12
    #if OFFLINE_TEST
    cfg.protocolClasses = [StubProtocol.self]
    #endif

    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: call.timeout)
    req.httpMethod = call.method
    req.httpShouldHandleCookies = false
    req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    if let body = call.body {
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
    }

    let session = URLSession(configuration: cfg, delegate: NoRedirect(), delegateQueue: nil)
    let done = DispatchSemaphore(value: 0)
    var result: (Data?, URLResponse?, Error?) = (nil, nil, nil)
    session.dataTask(with: req) { data, response, error in
        result = (data, response, error)
        done.signal()
    }.resume()
    // 여기부터는 서버가 받았을 수 있다 — 어떤 실패든 sent:true 다
    if done.wait(timeout: .now() + call.timeout + 5) == .timedOut { session.invalidateAndCancel(); ambiguous("TRANSPORT_TIMEOUT") }
    session.invalidateAndCancel()

    if let error = result.2 { ambiguous("TRANSPORT", detail: (error as NSError).code) }
    guard let http = result.1 as? HTTPURLResponse, http.url?.host == apiHost, http.url?.scheme == "https" else { ambiguous("RESPONSE_ORIGIN") }
    let data = result.0 ?? Data()
    guard data.count <= maxResponseBytes else { ambiguous("RESPONSE_TOO_LARGE") }
    guard let text = String(data: data, encoding: .utf8) else { ambiguous("RESPONSE_NOT_UTF8") }
    // 공급자 오류 본문도 원장에 남으므로 인증 문자열은 이 경계에서 제거한다.
    let safeBody = text.replacingOccurrences(of: key, with: "[REDACTED]", options: .literal)
    emit(["ok": true, "httpStatus": http.statusCode, "body": safeBody], code: 0)
}

// ── 모드 ─────────────────────────────────────────────────────

func runRequest() -> Never {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let call = parseCall(input) else { notSent("BAD_REQUEST") }
    switch loadKey(interactive: false) {
    case .failure(let e): notSent(e.code, detail: e.osStatus)
    case .success(let key): send(call, key: key)
    }
}

func statusFields() -> [String: Any] {
    var o: [String: Any] = ["mode": "status", "clientVersion": clientVersion, "item": itemPresence()]
    switch loadKey(interactive: false) {
    case .success: o["unattended"] = "READY"
    case .failure(let e): o["unattended"] = e.code; o["detail"] = e.osStatus
    }
    return o
}

func runStatus() -> Never {
    let o = statusFields()
    emit(o, code: o["unattended"] as? String == "READY" ? 0 : 10)
}

func runGrant() -> Never {
    var tty = isatty(0) == 1 && isatty(2) == 1
    #if OFFLINE_TEST
    if ProcessInfo.processInfo.environment["MPC_TEST_TTY"] == "1" { tty = true }
    #endif
    guard tty else { emit(["mode": "grant", "ok": false, "code": "GRANT_REQUIRES_TERMINAL"], code: 2) }
    FileHandle.standardError.write(Data("macOS 가 키체인 접근을 묻는 창을 띄웁니다. 로그인 암호를 넣고 \"항상 허용\"을 누르세요. (\"허용\"만 누르면 예약 실행에서는 다시 막힙니다)\n".utf8))
    if case .failure(let e) = loadKey(interactive: true) { emit(["mode": "grant", "ok": false, "code": e.code, "detail": e.osStatus], code: 10) }
    // 동의가 남았는지 — 창 없이 다시 읽어 본다
    var o = statusFields()
    o["mode"] = "grant"
    let ready = o["unattended"] as? String == "READY"
    o["ok"] = ready
    if !ready { o["code"] = "CONSENT_NOT_PERSISTENT" }
    emit(o, code: ready ? 0 : 10)
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 1 else { emit(["ok": false, "sent": false, "code": "USAGE"], code: 2) }
switch args[0] {
case "request": runRequest()
case "status": runStatus()
case "grant": runGrant()
case "version":
    emit(["mode": "version", "clientVersion": clientVersion, "service": keychainService, "account": keychainAccount, "host": apiHost,
          "textModels": textModels.sorted(), "imageModel": imageModel, "imageSize": imageSize,
          "maxManuscriptTokens": maxManuscriptTokens, "maxRepairTokens": maxRepairTokens], code: 0)
default: emit(["ok": false, "sent": false, "code": "USAGE"], code: 2)
}
