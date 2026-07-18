package com.tanyudii.tmuxweb.presentation

import com.tanyudii.tmuxweb.data.remote.ApiError
import com.tanyudii.tmuxweb.domain.model.EnvFile
import com.tanyudii.tmuxweb.presentation.fakes.FakeEnvironmentRepository
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class EnvFileEditorViewModelTest {
    private fun TestScope.viewModel(repository: FakeEnvironmentRepository) =
        EnvFileEditorViewModel("proj-1", "main", repository, backgroundScope)

    @Test
    fun `loads files and selects the first one by default`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.envFiles = listOf(
            EnvFile("docker-compose.yml", "services: {}\n"),
            EnvFile("pre-run.sh", "#!/bin/sh\n"),
        )
        val viewModel = viewModel(repository)

        runCurrent()

        assertEquals(false, viewModel.state.value.isLoading)
        assertEquals("docker-compose.yml", viewModel.state.value.selectedFilename)
        assertEquals("services: {}\n", viewModel.state.value.draftContent)
    }

    @Test
    fun `selectFile switches the draft to that file's content`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.envFiles = listOf(
            EnvFile("docker-compose.yml", "services: {}\n"),
            EnvFile("pre-run.sh", "#!/bin/sh\necho hi\n"),
        )
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.selectFile("pre-run.sh")

        assertEquals("pre-run.sh", viewModel.state.value.selectedFilename)
        assertEquals("#!/bin/sh\necho hi\n", viewModel.state.value.draftContent)
    }

    @Test
    fun `updateDraft edits in place without touching the repository`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.envFiles = listOf(EnvFile("env.json", "{}"))
        val viewModel = viewModel(repository)
        runCurrent()

        viewModel.updateDraft("""{"open":[]}""")

        assertEquals("""{"open":[]}""", viewModel.state.value.draftContent)
        assertEquals(emptyList(), repository.writeEnvFileCalls)
    }

    @Test
    fun `save writes the current draft and records success`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.envFiles = listOf(EnvFile("env.json", "{}"))
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.updateDraft("""{"open":[]}""")

        viewModel.save()
        runCurrent()

        assertEquals(listOf("env.json" to """{"open":[]}"""), repository.writeEnvFileCalls)
        assertEquals("env.json", viewModel.state.value.savedFilename)
        assertEquals(false, viewModel.state.value.isSaving)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `save failure surfaces a validation error without clearing the draft`() = runTest {
        val repository = FakeEnvironmentRepository()
        repository.envFiles = listOf(EnvFile("docker-compose.yml", "services: {}\n"))
        repository.writeEnvFileError = ApiError.Server(422, "yaml: bad indentation")
        val viewModel = viewModel(repository)
        runCurrent()
        viewModel.updateDraft("services:\n bad")

        viewModel.save()
        runCurrent()

        assertEquals("yaml: bad indentation", viewModel.state.value.errorMessage)
        assertEquals("services:\n bad", viewModel.state.value.draftContent)
        assertNull(viewModel.state.value.savedFilename)
    }
}
