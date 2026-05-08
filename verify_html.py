import asyncio
from playwright.async_api import async_playwright
import os

async def verify_html():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Use absolute path for the file
        path = os.path.abspath("telegram-youtube-ai-bot/index.html")
        page = await browser.new_page()
        await page.goto(f"file://{path}")

        print("Verifying page title...")
        title = await page.title()
        assert "Meine YT-Sammlung" in title

        print("Verifying video card presence...")
        # Check if at least one video card is present (based on the mock data I used earlier)
        cards = await page.query_selector_all(".card")
        assert len(cards) > 0
        print(f"Found {len(cards)} video card(s).")

        print("Verifying transcript toggle...")
        # Click the first transcript toggle button
        toggle_btn = await page.query_selector(".transcript-toggle")
        if toggle_btn:
            await toggle_btn.click()
            # Check if transcript box is now visible
            box = await page.query_selector(".transcript-box.open")
            assert box is not None
            text = await toggle_btn.inner_text()
            assert "VERBERGEN" in text.upper()
            print("Transcript toggle works.")

            # Take screenshot of open transcript
            os.makedirs("verification/screenshots", exist_ok=True)
            await page.screenshot(path="verification/screenshots/transcript_open_verified.png")

        print("Verifying search functionality...")
        search_input = await page.query_selector("#search-input")
        assert search_input is not None

        # Search for something that exists (e.g., "Python" from my mock)
        await search_input.fill("Python")
        await page.wait_for_timeout(500) # Wait for JS filter

        visible_cards = await page.query_selector_all(".card:not([style*='display: none'])")
        print(f"Visible cards after searching 'Python': {len(visible_cards)}")
        assert len(visible_cards) > 0

        # Search for something that doesn't exist
        await search_input.fill("NonExistentVideo123")
        await page.wait_for_timeout(500)
        visible_cards = await page.query_selector_all(".card:not([style*='display: none'])")
        print(f"Visible cards after searching nonsense: {len(visible_cards)}")
        assert len(visible_cards) == 0

        empty_state = await page.query_selector("#empty-state")
        is_visible = await empty_state.is_visible()
        assert is_visible
        print("Search and empty state verified.")

        print("Verifying category filtering...")
        # Clear search first
        await search_input.fill("")

        # Click "Technik" filter
        technik_btn = await page.query_selector(".filter-btn[data-cat='Technik']")
        await technik_btn.click()
        await page.wait_for_timeout(500)

        # Since our mock is Technik, it should still be visible
        visible_cards = await page.query_selector_all(".card:not([style*='display: none'])")
        assert len(visible_cards) > 0
        print("Filter 'Technik' verified.")

        # Click "Musik" filter
        musik_btn = await page.query_selector(".filter-btn[data-cat='Musik']")
        await musik_btn.click()
        await page.wait_for_timeout(500)
        visible_cards = await page.query_selector_all(".card:not([style*='display: none'])")
        assert len(visible_cards) == 0
        print("Filter 'Musik' verified (correctly hides non-matching).")

        await browser.close()
        print("Verification complete!")

if __name__ == "__main__":
    asyncio.run(verify_html())
