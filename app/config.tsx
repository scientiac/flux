import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

export default function Config() {
    const { config, updateRepoConfig } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const repoPath = config.repo;
    const currentRepoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [contentDir, setContentDir] = useState(currentRepoConfig?.contentDir || 'content/posts');
    const [assetsDir, setAssetsDir] = useState(currentRepoConfig?.assetsDir || 'static/assets');
    const [isValidating, setIsValidating] = useState(false);

    // Snackbar
    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    useEffect(() => {
        if (currentRepoConfig) {
            setContentDir(currentRepoConfig.contentDir);
            setAssetsDir(currentRepoConfig.assetsDir);
        }
    }, [currentRepoConfig]);

    const validateAndSave = async () => {
        if (!repoPath) return;
        setIsValidating(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            // Sanitize: strip trailing slashes to prevent // in paths
            const cleanContentDir = contentDir.endsWith('/') ? contentDir.slice(0, -1) : contentDir;
            const cleanAssetsDir = assetsDir.endsWith('/') ? assetsDir.slice(0, -1) : assetsDir;

            // 1. Ensure folders exist or create them
            const dirs = [cleanContentDir, cleanAssetsDir];
            for (const dir of dirs) {
                try {
                    await axios.get(`https://api.github.com/repos/${repoPath}/contents/${dir}`, {
                        headers: { Authorization: `token ${token}` }
                    });
                } catch (e: any) {
                    if (e.response?.status === 404) {
                        // Create placeholder to initialize folder
                        await axios.put(`https://api.github.com/repos/${repoPath}/contents/${dir}/.gitkeep`, {
                            message: `Initialize ${dir}`,
                            content: 'Ym9vdHN0cmFw', // "bootstrap" in base64
                        }, {
                            headers: { Authorization: `token ${token}` }
                        });
                    } else {
                        throw e;
                    }
                }
            }

            await updateRepoConfig(repoPath, {
                contentDir: cleanContentDir,
                assetsDir: cleanAssetsDir
            });
            setSnackbarMsg('Settings saved successfully');
            setSnackbarVisible(true);
            setTimeout(() => router.push('/files'), 1000);
        } catch (e: any) {
            setSnackbarMsg(e.message || 'Validation failed');
            setSnackbarVisible(true);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title="Site Settings" titleStyle={{ fontWeight: 'bold' }} />
            </Appbar.Header>

            <ScrollView contentContainerStyle={styles.content}>
                <Text variant="headlineSmall" style={styles.title}>Configure Content Paths</Text>
                <Text variant="bodyMedium" style={styles.subtitle}>
                    Settings for <Text style={{ fontWeight: 'bold' }}>{repoPath}</Text>
                </Text>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Posts Directory"
                        value={contentDir}
                        onChangeText={setContentDir}
                        mode="flat"
                        placeholder="e.g. content/posts"
                        style={styles.capsuleInput}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="folder-outline" />}
                    />
                    <HelperText type="info">Where your markdown files are stored.</HelperText>
                </View>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Assets Directory"
                        value={assetsDir}
                        onChangeText={setAssetsDir}
                        mode="flat"
                        placeholder="e.g. static/assets"
                        style={styles.capsuleInput}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="image-outline" />}
                    />
                    <HelperText type="info">Where images and media will be uploaded.</HelperText>
                </View>

                <Button
                    mode="contained"
                    onPress={validateAndSave}
                    loading={isValidating}
                    disabled={isValidating || !contentDir || !assetsDir}
                    style={styles.saveButton}
                    contentStyle={styles.saveButtonContent}
                    icon="content-save-outline"
                >
                    Save & Continue
                </Button>
            </ScrollView>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                style={{ backgroundColor: theme.colors.secondaryContainer, borderRadius: 12 }}
            >
                <Text style={{ color: theme.colors.onSecondaryContainer }}>{snackbarMsg}</Text>
            </Snackbar>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 24 },
    title: { fontWeight: 'bold', marginBottom: 8 },
    subtitle: { opacity: 0.7, marginBottom: 32 },
    inputGroup: { marginBottom: 16 },
    capsuleInput: {
        backgroundColor: 'rgba(0,0,0,0.03)',
    },
    saveButton: { marginTop: 24, borderRadius: 28 },
    saveButtonContent: { height: 56 },
});
