import XCTest

@testable import Omi_Computer

private actor OwnerFencePauseGate {
  private var released = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func pause() async {
    if released { return }
    await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    released = true
    waiters.forEach { $0.resume() }
    waiters = []
  }
}

/// Regression: an in-place account switch posts only .runtimeOwnerDidChange
/// (never .userDidSignOut), so AppState's account-owned conversation UI state
/// (folders, filters, counts, people) must fence itself or the previous
/// account's values keep rendering — and the reload sites skip while non-empty.
@MainActor
final class AppStateOwnerFenceTests: XCTestCase {
  func testRuntimeOwnerChangeClearsAccountScopedConversationState() throws {
    let state = AppState()
    let folder = try JSONDecoder().decode(
      Folder.self,
      from: Data(#"{"id":"previous-folder","name":"Previous account folder"}"#.utf8))
    state.folders = [folder]
    state.selectedFolderId = "previous-folder"
    state.selectedDateFilter = Date(timeIntervalSince1970: 1)
    state.showStarredOnly = true
    state.totalConversationsCount = 42
    state.filteredConversationsCount = 7
    state.conversationsError = "stale error"
    state.isLoadingConversations = true
    state.isLoadingFolders = true
    state.people = [Person(id: "previous-person", name: "Previous account person")]

    NotificationCenter.default.post(name: .runtimeOwnerDidChange, object: nil)

    XCTAssertTrue(state.folders.isEmpty, "previous account's folders must clear on switch")
    XCTAssertNil(state.selectedFolderId)
    XCTAssertNil(state.selectedDateFilter)
    XCTAssertFalse(state.showStarredOnly)
    XCTAssertNil(state.totalConversationsCount)
    XCTAssertNil(state.filteredConversationsCount)
    XCTAssertNil(state.conversationsError)
    XCTAssertFalse(state.isLoadingConversations)
    XCTAssertFalse(state.isLoadingFolders)
    XCTAssertTrue(state.people.isEmpty, "previous account's people must clear on switch")
  }

  /// Regression: the owner-fence observer registered with `queue: nil` and called
  /// `MainActor.assumeIsolated` in the block. `queue: nil` delivers the block
  /// synchronously on the *posting* thread, so a background poster made
  /// `assumeIsolated` trap and terminate the whole process (SIGTRAP). The fence must
  /// reach the main actor from any poster instead of asserting the poster was correct.
  func testRuntimeOwnerChangePostedOffTheMainThreadClearsStateWithoutTrapping() async throws {
    let state = AppState()
    let folder = try JSONDecoder().decode(
      Folder.self,
      from: Data(#"{"id":"previous-folder","name":"Previous account folder"}"#.utf8))
    state.folders = [folder]
    state.showStarredOnly = true
    state.totalConversationsCount = 42
    state.people = [Person(id: "previous-person", name: "Previous account person")]

    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        XCTAssertFalse(Thread.isMainThread, "precondition: the poster must not be the main thread")
        NotificationCenter.default.post(name: .runtimeOwnerDidChange, object: nil)
        continuation.resume()
      }
    }
    // A background post hops to the main queue; FIFO ordering means this barrier runs
    // after the fence, so the assertions below need no sleep.
    await withCheckedContinuation { continuation in
      DispatchQueue.main.async { continuation.resume() }
    }

    XCTAssertTrue(state.folders.isEmpty, "a background-thread owner switch must still clear folders")
    XCTAssertFalse(state.showStarredOnly)
    XCTAssertNil(state.totalConversationsCount)
    XCTAssertTrue(state.people.isEmpty)
  }

  func testInFlightFolderLoadFromPreviousAccountIsDroppedAfterOwnerSwitch() async throws {
    let state = AppState()
    let previousFolder = try JSONDecoder().decode(
      Folder.self,
      from: Data(#"{"id":"previous-folder","name":"Previous account folder"}"#.utf8))
    let gate = OwnerFencePauseGate()

    let load = Task { @MainActor in
      await state.loadFolders {
        await gate.pause()
        return [previousFolder]
      }
    }
    // Let the load start and suspend on the gate, then switch accounts mid-flight.
    await Task.yield()
    NotificationCenter.default.post(name: .runtimeOwnerDidChange, object: nil)
    await gate.release()
    await load.value

    XCTAssertTrue(
      state.folders.isEmpty,
      "a previous account's in-flight folder response must not repopulate after the switch")
  }

  func testInFlightPeopleFetchFromPreviousAccountIsDroppedAfterOwnerSwitch() async throws {
    let state = AppState()
    let gate = OwnerFencePauseGate()

    let load = Task { @MainActor in
      await state.fetchPeople {
        await gate.pause()
        return [Person(id: "previous-person", name: "Previous account person")]
      }
    }
    await Task.yield()
    NotificationCenter.default.post(name: .runtimeOwnerDidChange, object: nil)
    await gate.release()
    await load.value

    XCTAssertTrue(
      state.people.isEmpty,
      "a previous account's in-flight people response must not repopulate after the switch")
  }
}
